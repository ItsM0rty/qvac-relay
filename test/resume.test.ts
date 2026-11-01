import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Resumer } from '../src/resume.js';
import { RelayStore } from '../src/store.js';
import {
  parseRecord,
  revision,
  stableId,
  type CheckpointRecord,
  type RelayRecord,
} from '../src/records.js';
import { latestCheckpoint, type RunOptions } from '../src/agent.js';

async function fixture(body: (a: RelayStore, b: RelayStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'relay-resume-'));
  let a: RelayStore | undefined, b: RelayStore | undefined;
  try {
    a = await RelayStore.open(join(directory, 'a'));
    b = await RelayStore.open(join(directory, 'b'));
    await a.pair(b.owner);
    await b.pair(a.owner);
    await b.connect(await a.listen());
    await body(a, b);
  } finally {
    await Promise.allSettled([a?.close(), b?.close()]);
    await rm(directory, { recursive: true, force: true });
  }
}
function record(
  store: RelayStore,
  id: string,
  kind: string,
  extra: Record<string, unknown> = {},
  caseId = 'demo',
): RelayRecord {
  return parseRecord({
    schemaVersion: 1,
    id,
    owner: store.owner,
    caseId,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    kind,
    ...extra,
  });
}
async function seed(
  a: RelayStore,
  status: CheckpointRecord['status'] = 'pending',
  extra: Record<string, unknown> = {},
): Promise<CheckpointRecord> {
  await a.put(record(a, 'case-1', 'case', { title: 'Deployment', task: 'Investigate failure' }));
  await a.put(record(a, 'request-1', 'request', { question: 'Need the missing failure log' }));
  const checkpoint = record(a, 'cp-1', 'checkpoint', {
    runId: 'run-original',
    status,
    task: 'Investigate failure',
    calls: 3,
    repairs: 1,
    consumed: [],
    requestIds: ['request-1'],
    ...extra,
  }) as CheckpointRecord;
  await a.put(checkpoint);
  return checkpoint;
}
async function contribute(
  a: RelayStore,
  b: RelayStore,
  id = 'evidence-remote',
  requestId = 'request-1',
): Promise<void> {
  await b.put(
    record(b, id, 'evidence', {
      title: 'Failure log',
      text: 'The deployment failed because the disk was full.',
      requestId,
    }),
  );
  for (let tries = 0; tries < 80; tries++) {
    if ((await a.list('demo')).some((item) => item.id === id)) return;
    await delay(25);
  }
  throw new Error('Remote contribution did not replicate');
}
function agent(a: RelayStore, status: CheckpointRecord['status'] = 'completed') {
  const invocations: Array<{ caseId: string; options: RunOptions }> = [];
  return {
    invocations,
    isActive: false,
    async run(caseId: string, options: RunOptions = {}): Promise<CheckpointRecord> {
      invocations.push({ caseId, options });
      const cp = record(
        a,
        stableId(options.runId!, 'fake-final'),
        'checkpoint',
        {
          runId: options.runId!,
          status,
          task: 'Investigate failure',
          calls: (options.initialCalls ?? 0) + 1,
          repairs: options.initialRepairs ?? 0,
          consumed: options.consumed ?? [],
          requestIds: ['request-1'],
        },
        caseId,
      ) as CheckpointRecord;
      cp.createdAt = new Date().toISOString();
      await a.put(cp);
      return cp;
    },
  };
}
test('relevant replicated evidence resumes once with cumulative budgets and survives coordinator restart', async () => {
  await fixture(async (a, b) => {
    const previous = await seed(a, 'pending', {
      consumed: ['older-evidence'],
      lastFailure: 'validation:QUOTE:bad quote',
    });
    await contribute(a, b);
    const worker = agent(a);
    const coordinator = new Resumer(a, worker, { maxCalls: 12, maxRepairs: 2 });
    const [left, right] = await Promise.all([coordinator.scan(), coordinator.scan()]);
    assert.equal(worker.invocations.length, 1);
    assert.equal(left[0]?.status, 'completed');
    assert.deepEqual(left, right);
    const options = worker.invocations[0]!.options;
    assert.equal(options.runId, stableId('resume', previous.runId, 'evidence-remote'));
    assert.deepEqual(options.requiredIds, ['evidence-remote']);
    assert.deepEqual(options.consumed, ['evidence-remote', 'older-evidence']);
    assert.equal(options.initialCalls, 3);
    assert.equal(options.initialRepairs, 1);
    assert.equal(options.initialFailure, previous.lastFailure);
    assert.equal(options.maxCalls, 12);
    await coordinator.close();
    const restarted = new Resumer(a, worker);
    await restarted.scan();
    await restarted.close();
    assert.equal(worker.invocations.length, 1);
    assert.equal(latestCheckpoint(await a.list('demo'), a.owner)?.calls, 4);
    const trace = await readFile(join(a.directory, 'traces', 'resumption.jsonl'), 'utf8');
    assert.match(trace, /resume_started/);
    assert.match(trace, /evidence-remote/);
  });
});
test('unrelated, already consumed and local evidence cannot resume pending work', async () => {
  await fixture(async (a, b) => {
    await seed(a, 'pending', { consumed: ['already-consumed'] });
    await contribute(a, b, 'unrelated', 'another-request');
    await contribute(a, b, 'already-consumed');
    await a.put(
      record(a, 'local-evidence', 'evidence', {
        title: 'Local note',
        text: 'Local addition',
        requestId: 'request-1',
      }),
    );
    const worker = agent(a);
    const coordinator = new Resumer(a, worker);
    assert.deepEqual(await coordinator.scan(), []);
    assert.equal(worker.invocations.length, 0);
    await coordinator.close();
  });
});
test('terminal checkpoints never automatically resume', async () => {
  for (const status of ['completed', 'failed', 'cancelled'] as const)
    await fixture(async (a, b) => {
      await seed(a, status);
      await contribute(a, b);
      const worker = agent(a);
      const coordinator = new Resumer(a, worker);
      await coordinator.scan();
      assert.equal(worker.invocations.length, 0);
      await coordinator.close();
    });
});
test('interrupted runs recover with stable identity and preserved counters', async () => {
  await fixture(async (a) => {
    const previous = await seed(a, 'running', { consumed: ['prior-contribution'] });
    const worker = agent(a);
    const coordinator = new Resumer(a, worker);
    await coordinator.scan();
    const options = worker.invocations[0]!.options;
    assert.equal(options.runId, stableId('recovery', previous.runId));
    assert.equal(options.initialCalls, 3);
    assert.deepEqual(options.requiredIds, ['prior-contribution']);
    await coordinator.close();
  });
});
test('crash after brief commit settles persisted outcome without executing tools again', async () => {
  await fixture(async (a) => {
    const previous = await seed(a, 'running');
    const brief = record(a, stableId(previous.runId, 'brief'), 'brief', {
      facts: [
        {
          text: 'Observed failure',
          sources: [{ id: 'known-source', revision: stableId('revision'), quote: 'failure' }],
        },
      ],
      uncertainty: [],
      missing: ['Need log'],
      basedOn: stableId('snapshot'),
    });
    await a.put(brief);
    const worker = agent(a);
    const coordinator = new Resumer(a, worker);
    const result = await coordinator.scan();
    assert.equal(result[0]?.status, 'pending');
    assert.equal(result[0]?.briefId, brief.id);
    assert.equal(worker.invocations.length, 0);
    assert.equal((await a.list('demo')).filter((item) => item.kind === 'brief').length, 1);
    await coordinator.close();
  });
});

for (const writer of ['remote', 'owner'] as const)
  test(`recovery resumes a committed brief when a request answer arrived after its citations (${writer})`, async () => {
    await fixture(async (a, b) => {
      const previous = await seed(a, 'running');
      const local = record(a, 'source-before-crash', 'evidence', {
        title: 'Initial log',
        text: 'The deployment failed.',
      });
      await a.put(local);
      const brief = record(a, stableId(previous.runId, 'brief'), 'brief', {
        facts: [
          {
            text: 'Observed failure',
            sources: [{ id: local.id, revision: revision(local), quote: 'The deployment failed.' }],
          },
        ],
        uncertainty: [],
        missing: ['Need the missing failure log'],
        basedOn: stableId('old-snapshot'),
      });
      await a.put(brief);
      await contribute(a, writer === 'owner' ? a : b);
      const worker = agent(a);
      const coordinator = new Resumer(a, worker, { maxCalls: 12 });
      const outcomes = await coordinator.scan();
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status),
        ['pending', 'completed'],
      );
      assert.equal(outcomes[0]?.briefId, brief.id);
      assert.equal(worker.invocations.length, 1);
      const carried = worker.invocations[0]!.options;
      assert.equal(carried.runId, stableId('resume', previous.runId, 'evidence-remote'));
      assert.equal(carried.initialCalls, previous.calls);
      assert.equal(carried.initialRepairs, previous.repairs);
      assert.deepEqual(carried.requiredIds, ['evidence-remote', local.id].sort());
      assert.equal((await a.list('demo')).filter((item) => item.kind === 'brief').length, 1);
      await coordinator.scan();
      assert.equal(worker.invocations.length, 1);
      await coordinator.close();
    });
  });

test('pending brief with a stale citation resumes even if its evidence ID was already consumed', async () => {
  await fixture(async (a, b) => {
    const briefId = stableId('accepted-before-revision');
    const previous = await seed(a, 'pending', { consumed: ['evidence-remote'], briefId });
    await contribute(a, b);
    const remote = (await a.get('evidence-remote'))!;
    const staleRevision = stableId('previous-evidence-revision');
    assert.notEqual(staleRevision, revision(remote));
    await a.put(
      record(a, briefId, 'brief', {
        facts: [
          {
            text: 'Earlier observation',
            sources: [
              {
                id: remote.id,
                revision: staleRevision,
                quote: 'The deployment failed because the disk was full.',
              },
            ],
          },
        ],
        uncertainty: [],
        missing: [],
        basedOn: stableId('old-snapshot'),
      }),
    );
    const worker = agent(a);
    const coordinator = new Resumer(a, worker, { maxCalls: 12 });
    await coordinator.scan();
    assert.equal(worker.invocations.length, 1);
    const carried = worker.invocations[0]!.options;
    assert.equal(carried.runId, stableId('resume', previous.runId, remote.id));
    assert.deepEqual(carried.requiredIds, [remote.id]);
    assert.deepEqual(carried.consumed, [remote.id]);
    assert.equal(carried.initialCalls, previous.calls);
    await coordinator.close();
    const restarted = new Resumer(a, worker);
    await restarted.scan();
    assert.equal(worker.invocations.length, 1);
    await restarted.close();
  });
});

for (const writer of ['remote', 'owner'] as const)
  test(`recovery completes without inference when the committed brief already cites the answer revision (${writer})`, async () => {
    await fixture(async (a, b) => {
      const previous = await seed(a, 'running');
      await contribute(a, writer === 'owner' ? a : b);
      const remote = (await a.get('evidence-remote'))!;
      const brief = record(a, stableId(previous.runId, 'brief'), 'brief', {
        facts: [
          {
            text: 'Observed failure',
            sources: [
              {
                id: remote.id,
                revision: revision(remote),
                quote: 'The deployment failed because the disk was full.',
              },
            ],
          },
        ],
        uncertainty: [],
        missing: [],
        basedOn: stableId('current-snapshot'),
      });
      await a.put(brief);
      const worker = agent(a);
      const coordinator = new Resumer(a, worker);
      const outcomes = await coordinator.scan();
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status),
        ['completed'],
      );
      assert.equal(outcomes[0]?.briefId, brief.id);
      assert.equal(worker.invocations.length, 0);
      await coordinator.close();
    });
  });
test('cumulative exhausted calls and repeated crash recovery stop without new inference', async () => {
  await fixture(async (a) => {
    await seed(a, 'running', { calls: 10 });
    const worker = agent(a);
    const coordinator = new Resumer(a, worker);
    assert.equal((await coordinator.scan())[0]?.status, 'failed');
    assert.equal(worker.invocations.length, 0);
    await coordinator.close();
  });
  await fixture(async (a) => {
    const original = await seed(a, 'running');
    const first = stableId('recovery', original.runId);
    const second = stableId('recovery', first);
    const one = {
      ...original,
      id: 'cp-recovery-1',
      runId: first,
      createdAt: new Date(Date.now() - 500).toISOString(),
    };
    const two = {
      ...original,
      id: 'cp-recovery-2',
      runId: second,
      createdAt: new Date().toISOString(),
    };
    await a.put(one);
    await a.put(two);
    const worker = agent(a);
    const coordinator = new Resumer(a, worker);
    assert.equal((await coordinator.scan())[0]?.status, 'failed');
    assert.equal(worker.invocations.length, 0);
    await coordinator.close();
  });
});
test('coordinator close aborts its active run and removes watchers', async () => {
  await fixture(async (a) => {
    await seed(a, 'running');
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let observed: AbortSignal | undefined;
    const worker = {
      async run(_caseId: string, options: RunOptions = {}): Promise<CheckpointRecord> {
        observed = options.signal;
        began();
        await new Promise<void>((resolve) =>
          options.signal!.addEventListener('abort', () => resolve(), { once: true }),
        );
        return (await a.list('demo')).find(
          (item) => item.kind === 'checkpoint',
        ) as CheckpointRecord;
      },
    };
    const coordinator = new Resumer(a, worker);
    const scan = coordinator.scan();
    await started;
    await coordinator.close();
    await scan;
    assert.equal(observed?.aborted, true);
    assert.deepEqual(await coordinator.scan(), []);
    assert.equal(a.listenerCount('change'), 0);
  });
});
test('manual active work is not mistaken for an interrupted run', async () => {
  await fixture(async (a) => {
    await seed(a, 'running');
    const worker = agent(a);
    worker.isActive = true;
    const coordinator = new Resumer(a, worker);
    await coordinator.scan();
    assert.equal(worker.invocations.length, 0);
    await coordinator.close();
  });
});
test('remote notifications trigger scans, duplicates stay harmless and cleanup removes watchers', async () => {
  await fixture(async (a, b) => {
    await seed(a);
    const worker = agent(a, 'pending');
    const coordinator = new Resumer(a, worker);
    coordinator.start(60_000);
    assert.equal(a.listenerCount('change'), 1);
    await contribute(a, b);
    for (let tries = 0; tries < 80 && worker.invocations.length === 0; tries++) await delay(25);
    assert.equal(worker.invocations.length, 1);
    for (let index = 0; index < 5; index++) a.emit('change', { remote: true, owner: b.owner });
    a.emit('change', { remote: false, owner: a.owner });
    await coordinator.scan();
    await delay(50);
    assert.equal(worker.invocations.length, 1);
    await coordinator.close();
    assert.equal(a.listenerCount('change'), 0);
  });
});
test('reopening the physical store retains contribution consumption and terminal status', async () => {
  await fixture(async (a, b) => {
    await seed(a);
    await contribute(a, b);
    const worker = agent(a);
    const coordinator = new Resumer(a, worker);
    await coordinator.scan();
    await coordinator.close();
    const directory = a.directory;
    const owner = a.owner;
    await a.close();
    const reopened = await RelayStore.open(directory);
    try {
      assert.equal(reopened.owner, owner);
      const next = agent(reopened);
      const restarted = new Resumer(reopened, next);
      await restarted.scan();
      assert.equal(next.invocations.length, 0);
      const saved = latestCheckpoint(await reopened.list('demo'), owner)!;
      assert.equal(saved.status, 'completed');
      assert.deepEqual(saved.consumed, ['evidence-remote']);
      await restarted.close();
    } finally {
      await reopened.close();
    }
  });
});
