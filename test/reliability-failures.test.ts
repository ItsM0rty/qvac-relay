import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from '../src/agent.js';
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
