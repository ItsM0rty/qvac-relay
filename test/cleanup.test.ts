import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../src/agent.js';
import { validateHistory } from '../src/context.js';
import { RelayError } from '../src/policy.js';
import { RelayStore } from '../src/store.js';
import type { Message, Model, ModelReply } from '../src/qvac.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'relay-cleanup-'));
  const store = await RelayStore.open(directory);
  const base = {
    schemaVersion: 1 as const,
    owner: store.owner,
    caseId: 'cleanup-case',
    createdAt: '2026-10-31T00:00:00.000Z',
  };
  await store.put({
    ...base,
    id: 'cleanup-case',
    kind: 'case',
    title: 'Deployment handoff',
    task: 'Summarize the deployment log with an exact citation.',
  });
  await store.put({
    ...base,
    id: 'source-log',
    kind: 'evidence',
    title: 'Deployment log',
    text: 'Deployment 42 completed at 09:10.',
  });
  return {
    store,
    directory,
    events: async (runId: string) =>
      (await readFile(join(directory, 'traces', `${runId}.jsonl`), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    close: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function action(name: string, args: unknown, id: string): ModelReply {
  return { content: '', calls: [{ id, name, arguments: args }], toolErrors: [], stopReason: 'eos' };
}

test('cleanup failure after acceptance preserves the persisted completed checkpoint and brief', async () => {
  const f = await fixture();
  let modelCalls = 0;
  let releases = 0;
  const cleanupFailure = new RelayError(
    'MODEL_RELEASE_FAILED',
    'Native unload failed after acceptance.',
    'infrastructure',
  );
  const model: Model = {
    name: 'controlled-cleanup-fixture-not-live',
    complete: async (history: Message[], tools): Promise<ModelReply> => {
      validateHistory(history);
      modelCalls++;
      if (modelCalls === 1) return action('read_record', { id: 'source-log' }, 'read-1');
      assert.equal(modelCalls, 2, 'Accepted task must stop without another model call');
      assert.ok(tools.some((tool) => tool.name === 'save_brief'));
      const readMessage = history.findLast(
        (message) => message.role === 'tool' && message.toolName === 'read_record',
      );
      assert.ok(readMessage);
      const read = JSON.parse(readMessage.content) as {
        id: string;
        text: string;
        revision: string;
      };
      assert.equal(read.id, 'source-log');
      assert.equal(read.text, 'Deployment 42 completed at 09:10.');
      return action(
        'save_brief',
        {
          facts: [
            {
              text: read.text,
              sources: [{ id: read.id, revision: read.revision, quote: read.text }],
            },
          ],
          uncertainty: [],
          missing: [],
        },
        'save-2',
      );
    },
    release: async () => {
      releases++;
      if (modelCalls === 2) throw cleanupFailure;
    },
    close: async () => {},
  };
  try {
    const agent = new Agent(f.store, model);
    const completed = await agent.run('cleanup-case', { runId: 'accepted-cleanup' });
    assert.equal(completed.status, 'completed');
    assert.ok(completed.briefId);
    assert.equal(agent.lastCleanupError, cleanupFailure.message);
    assert.equal(agent.isActive, false);
    const records = await f.store.list('cleanup-case');
    assert.deepEqual(
      records.find((record) => record.id === completed.id),
      completed,
    );
    const brief = records.find((record) => record.id === completed.briefId);
    assert.equal(brief?.kind, 'brief');
    assert.equal(records.filter((record) => record.kind === 'brief').length, 1);
    assert.equal(
      records.filter((record) => record.kind === 'checkpoint' && record.status === 'failed').length,
      0,
    );
    const events = await f.events('accepted-cleanup');
    const cleanup = events.find((event) => event.event === 'cleanup_failed');
    assert.ok(cleanup);
    assert.equal(cleanup.kind, 'infrastructure');
    assert.equal(cleanup.code, 'MODEL_RELEASE_FAILED');
    assert.equal(
      releases,
      1,
      'Pure lexical selection releases the generator only during final cleanup',
    );
  } finally {
    await f.close();
  }
});

test('cleanup failure before context selection stops as infrastructure without a generator call or selector fallback', async () => {
  const f = await fixture();
  let modelCalls = 0;
  let selectorCalls = 0;
  let releases = 0;
  const cleanupFailure = new RelayError(
    'MODEL_RELEASE_FAILED',
    'Native model resource could not be released before context selection.',
    'infrastructure',
  );
  const model: Model = {
    name: 'controlled-pre-context-cleanup-fixture-not-live',
    complete: async () => {
      modelCalls++;
      throw new Error('Generator must not be called after native cleanup failure');
    },
    release: async () => {
      releases++;
      throw cleanupFailure;
    },
    close: async () => {},
  };
  try {
    const agent = new Agent(f.store, model);
    const failed = await agent.run('cleanup-case', {
      runId: 'context-cleanup',
      selector: {
        select: async () => {
          selectorCalls++;
          return { ids: ['source-log'], policy: 'controlled' };
        },
      },
    });
    assert.equal(failed.status, 'failed');
    assert.match(failed.reason!, /^infrastructure: Native model resource could not be released/);
    assert.equal(failed.calls, 0);
    assert.equal(modelCalls, 0);
    assert.equal(selectorCalls, 0);
    assert.equal(agent.lastCleanupError, cleanupFailure.message);
    assert.equal(agent.isActive, false);
    const events = await f.events('context-cleanup');
    assert.equal(
      events.some((event) => event.event === 'model'),
      false,
    );
    assert.equal(
      events.some((event) => event.event === 'context'),
      false,
    );
    assert.equal(
      events.some((event) => event.event === 'cleanup_failed' && event.kind === 'infrastructure'),
      true,
    );
    assert.equal(
      (await f.store.list('cleanup-case')).some((record) => record.kind === 'brief'),
      false,
    );
    assert.equal(releases, 2, 'Initial cleanup failure and final cleanup retry are distinct');
  } finally {
    await f.close();
  }
});
