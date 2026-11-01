import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, latestCheckpoint } from '../src/agent.js';
import { Resumer } from '../src/resume.js';
import { RelayStore } from '../src/store.js';
import type { RelayRecord } from '../src/records.js';
import type { Message, Model, ModelReply } from '../src/qvac.js';

const action = (id: string, name: string, args: unknown): ModelReply => ({
  content: '',
  calls: [{ id, name, arguments: args }],
  toolErrors: [],
  stopReason: 'eos',
});
function model(steps: Array<(history: Message[]) => Promise<ModelReply> | ModelReply>): Model {
  let turn = 0;
  return {
    name: 'controlled-reliability-fixture-not-live',
    async complete(history) {
      const step = steps[turn++];
      assert.ok(step, `Unexpected model turn ${turn}`);
      return step(history);
    },
    async close() {},
  };
}
function base(store: RelayStore) {
  return {
    schemaVersion: 1 as const,
    owner: store.owner,
    caseId: 'incident',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
async function seed(store: RelayStore): Promise<void> {
  await store.put({
    ...base(store),
    id: 'case',
    kind: 'case',
    title: 'Incident',
    task: 'Investigate deployment log and request configuration.',
  });
  await store.put({
    ...base(store),
    id: 'log',
    kind: 'evidence',
    title: 'Deployment log',
    text: 'Deployment timed out.',
  });
}
function result<T>(history: Message[], name: string): T {
  const message = history.findLast((entry) => entry.role === 'tool' && entry.toolName === name);
  assert.ok(message);
  return JSON.parse(message.content) as T;
}
function finishFromRead(history: Message[]): ModelReply {
  const read = result<{ id: string; text: string }>(history, 'read_record');
  return action('save', 'save_brief', {
    quotes: { [read.id]: read.text },
    uncertainty: [],
    missing: [],
  });
}

test(
  'request committed at cancellation boundary survives restart and a retry does not duplicate it',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-request-boundary-'));
    let store = await RelayStore.open(directory);
    try {
      await seed(store);
      const controller = new AbortController();
      const put = store.put.bind(store);
      store.put = async (record, options) => {
        const written = await put(record, options);
        if (record.kind === 'request') {
          controller.abort();
          throw new DOMException('Injected loss after commit', 'AbortError');
        }
        return written;
      };
      const question = 'Which configuration changed?';
      const initial = await new Agent(
        store,
        model([() => action('request-1', 'request_information', { question })]),
      ).run('incident', { signal: controller.signal, runId: 'boundary-run' });
      assert.equal(initial.status, 'cancelled');
      const trace = await readFile(join(directory, 'traces', 'boundary-run.jsonl'), 'utf8');
      assert.equal(
        trace
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .some((e) => e.event === 'tool' && e.name === 'request_information' && e.ok),
        false,
      );
      const before = (await store.list('incident')).filter((record) => record.kind === 'request');
      assert.equal(before.length, 1);
      await store.close();
      store = await RelayStore.open(directory);
      const retried = await new Agent(
        store,
        model([
          () => action('request-2', 'request_information', { question }),
          (history) => {
            const request = result<{ id: string; duplicate: boolean }>(
              history,
              'request_information',
            );
            assert.equal(request.id, before[0]!.id);
            assert.equal(request.duplicate, true);
            return action('read', 'read_record', { id: 'log' });
          },
          (history) => finishFromRead(history),
        ]),
      ).run('incident', { runId: 'retry-run' });
      assert.equal(retried.status, 'pending', retried.reason ?? '');
      const after = (await store.list('incident')).filter((record) => record.kind === 'request');
      assert.equal(after.length, 1);
      assert.deepEqual(after[0], before[0]);
      assert.ok(retried.requestIds.includes(before[0]!.id));
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'active work fails on unavailable paired blocks and a reconnect permits an honest retry',
  { timeout: 45000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-remote-boundary-'));
    let a: RelayStore | undefined;
    let b: RelayStore | undefined;
    try {
      a = await RelayStore.open(join(directory, 'a'));
      b = await RelayStore.open(join(directory, 'b'));
      await seed(a);
      await b.put({
        ...base(b),
        caseId: 'other',
        id: 'baseline',
        kind: 'evidence',
        title: 'Baseline',
        text: 'Existing remote block.',
      });
      await a.pair(b.owner);
      const port = await b.listen();
      await a.connect(port);
      for (let i = 0; i < 100 && !a.remoteStatus()[0]?.knownBlocks; i++) await delay(50);
      assert.ok(a.remoteStatus()[0]?.knownBlocks, 'remote header did not replicate');
      await a.list('incident');
      const known = a.remoteStatus()[0]!.knownBlocks;
      const source: RelayRecord = {
        ...base(b),
        id: 'remote-config',
        kind: 'evidence',
        title: 'Deployment config',
        text: 'The timeout was 3000 ms.',
      };
      const first = model([
        async () => {
          await b!.put(source);
          for (let i = 0; i < 100 && a!.remoteStatus()[0]!.knownBlocks <= known; i++)
            await delay(50);
          assert.ok(a!.remoteStatus()[0]!.knownBlocks > known, 'new remote header did not arrive');
          a!.disconnect();
          return action('request', 'request_information', {
            question: 'What configuration changed?',
          });
        },
      ]);
      const failed = await new Agent(a, first).run('incident', { runId: 'missing-block' });
      assert.equal(failed.status, 'failed');
      assert.match(failed.reason!, /^infrastructure:.*Cannot read peer/);
      await a.connect(port);
      let records: RelayRecord[] = [];
      for (let i = 0; i < 100; i++) {
        try {
          records = await a.list('incident');
          if (records.some((record) => record.id === source.id)) break;
        } catch {
          /* Wait for replication. */
        }
        await delay(50);
      }
      assert.ok(records.some((record) => record.id === source.id));
      assert.equal(
        records.some((record) => record.kind === 'request'),
        false,
        'unavailable evidence must not become a fabricated missing-information request',
      );
      const retry = await new Agent(
        a,
        model([
          () => action('find', 'find_evidence', { query: 'remote-config' }),
          (history) => {
            const found = result<Array<{ id: string }>>(history, 'find_evidence');
            assert.equal(found[0]?.id, source.id);
            return action('read', 'read_record', { id: source.id });
          },
          (history) => finishFromRead(history),
        ]),
      ).run('incident', { runId: 'reconnected' });
      assert.equal(retry.status, 'completed', retry.reason ?? '');
      const final = await a.list('incident');
      assert.ok(
        final.some(
          (record) =>
            record.kind === 'brief' &&
            record.facts.some((fact) => fact.sources.some((ref) => ref.id === source.id)),
        ),
      );
      assert.equal(
        final.some((record) => record.kind === 'request'),
        false,
      );
    } finally {
      await Promise.allSettled([a?.close(), b?.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'request-only pending resumes once after a real peer contribution',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-request-only-'));
    let a: RelayStore | undefined;
    let b: RelayStore | undefined;
    let coordinator: Resumer | undefined;
    try {
      a = await RelayStore.open(join(directory, 'a'));
      b = await RelayStore.open(join(directory, 'b'));
      await a.put({
        ...base(a),
        id: 'case',
        kind: 'case',
        title: 'Broker incident',
        task: 'Find the broker configuration.',
      });
      await a.pair(b.owner);
      await b.pair(a.owner);
      await b.connect(await a.listen());
      const question = 'What broker setting changed?';
      const waiting = await new Agent(
        a,
        model([
          () => action('ask', 'request_information', { question }),
          () => ({
            content: 'Waiting for the requested evidence.',
            calls: [],
            toolErrors: [],
            stopReason: 'eos',
          }),
        ]),
      ).run('incident', { runId: 'request-only' });
      assert.equal(waiting.status, 'pending', waiting.reason ?? '');
      assert.equal(waiting.briefId, undefined);
      assert.equal(waiting.calls, 2);
      assert.equal(waiting.repairs, 0);
      const initial = await a.list('incident');
      assert.equal(initial.filter((record) => record.kind === 'brief').length, 0);
      const request = initial.find((record) => record.kind === 'request');
      assert.ok(request && request.kind === 'request');
      assert.deepEqual(waiting.requestIds, [request.id]);
      let seenRequest = false;
      for (let i = 0; i < 100; i++) {
        if ((await b.list('incident')).some((record) => record.id === request.id)) {
          seenRequest = true;
          break;
        }
        await delay(50);
      }
      assert.ok(seenRequest, 'peer did not receive the persisted request');
      let calls = 0;
      const worker = new Agent(
        a,
        model([
          () => {
            calls++;
            return action('read-response', 'read_record', { id: 'broker-response' });
          },
          (history) => {
            calls++;
            return finishFromRead(history);
          },
        ]),
      );
      coordinator = new Resumer(a, worker, { maxCalls: 12, maxRepairs: 2 });
      coordinator.start(100);
      await b.put({
        ...base(b),
        id: 'broker-response',
        kind: 'evidence',
        title: 'Broker configuration',
        text: 'The broker timeout is 3000 ms.',
        requestId: request.id,
      });
      let completed = undefined as ReturnType<typeof latestCheckpoint>;
      for (let i = 0; i < 150; i++) {
        const records = await a.list('incident');
        const checkpoint = latestCheckpoint(records, a.owner);
        if (checkpoint?.status === 'completed') {
          completed = checkpoint;
          break;
        }
        if (checkpoint?.status === 'failed') assert.fail(checkpoint.reason ?? 'resumption failed');
        await delay(50);
      }
      assert.ok(completed, 'automatic resumption did not complete');
      assert.equal(completed.calls, 4);
      assert.equal(completed.repairs, 0);
      assert.deepEqual(completed.consumed, ['broker-response']);
      const records = await a.list('incident');
      const briefs = records.filter((record) => record.kind === 'brief');
      assert.equal(briefs.length, 1);
      assert.ok(
        briefs[0]?.kind === 'brief' &&
          briefs[0].facts.some((fact) =>
            fact.sources.some(
              (source) =>
                source.id === 'broker-response' &&
                source.quote === 'The broker timeout is 3000 ms.',
            ),
          ),
      );
      await coordinator.scan();
      await coordinator.scan();
      assert.equal(calls, 2);
      assert.equal(
        (await a.list('incident')).filter((record) => record.kind === 'brief').length,
        1,
      );
    } finally {
      await coordinator?.close();
      await Promise.allSettled([a?.close(), b?.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

for (const [name, reply] of [
  ['malformed', { content: 'Incomplete.', calls: [], toolErrors: ['invalid'], stopReason: 'eos' }],
  ['length-limited', { content: 'Incomplete.', calls: [], toolErrors: [], stopReason: 'length' }],
] as const) {
  test(
    `${name} output after a request does not create request-only pending`,
    { timeout: 20000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'relay-request-invalid-'));
      const store = await RelayStore.open(directory);
      try {
        await store.put({
          ...base(store),
          id: 'case',
          kind: 'case',
          title: 'Broker',
          task: 'Find the broker setting.',
        });
        const checkpoint = await new Agent(
          store,
          model([
            () =>
              action('ask', 'request_information', { question: 'What broker setting changed?' }),
            () => ({ ...reply, calls: [...reply.calls], toolErrors: [...reply.toolErrors] }),
          ]),
        ).run('incident', { runId: `invalid-${name}`, maxRepairs: 0 });
        assert.equal(checkpoint.status, 'failed');
        assert.equal(checkpoint.briefId, undefined);
        assert.equal(
          (await store.list('incident')).filter((record) => record.kind === 'brief').length,
          0,
        );
        assert.equal(
          (await store.list('incident')).filter((record) => record.kind === 'request').length,
          1,
        );
      } finally {
        await store.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
