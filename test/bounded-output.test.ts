import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent.js';
import { validateHistory } from '../src/context.js';
import { RelayStore } from '../src/store.js';
import type { Message, Model, ModelReply, ToolSpec } from '../src/qvac.js';

const question = 'What timeout setting was deployed?';
const longProse = 'Unexpected prose without a tool call. '.repeat(100);
type Step = (history: Message[], turn: number) => ModelReply;
class ScriptedModel implements Model {
  readonly name = 'output-limit-regression-not-live';
  private turn = 0;
  constructor(private readonly steps: Step[]) {}
  async complete(history: Message[], _tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    signal.throwIfAborted();
    validateHistory(history);
    assert.ok(!history.some((message) => message.content.includes(longProse)));
    const turn = ++this.turn;
    assert.ok(this.steps[turn - 1], `Unexpected model turn ${turn}`);
    return this.steps[turn - 1]!(history, turn);
  }
  async close(): Promise<void> {}
}
function action(name: string, args: unknown, turn: number): ModelReply {
  return {
    content: '',
    calls: [{ id: `call-${turn}`, name, arguments: args }],
    toolErrors: [],
    stopReason: 'eos',
  };
}
function lengthReply(): ModelReply {
  return { content: longProse, calls: [], toolErrors: [], stopReason: 'length' };
}
function result<T>(history: Message[], name: string, expectedId: string): T {
  const message = history.findLast((item) => item.role === 'tool' && item.toolName === name);
  assert.ok(message);
  assert.equal(message.toolCallId, expectedId);
  assert.ok(
    history.some(
      (item) =>
        item.role === 'assistant' &&
        item.toolCalls?.some((call) => call.id === expectedId && call.name === name),
    ),
  );
  return JSON.parse(message.content) as T;
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'relay-output-limit-'));
  const store = await RelayStore.open(directory);
  const base = {
    schemaVersion: 1 as const,
    owner: store.owner,
    caseId: 'incident',
    createdAt: '2026-10-31T00:00:00.000Z',
  };
  await store.put({
    ...base,
    kind: 'case',
    id: 'incident-case',
    title: 'Configuration',
    task: 'Investigate the timeout.',
    informationNeeds: [{ id: 'timeout', question }],
  });
  await store.put({
    ...base,
    kind: 'evidence',
    id: 'incident-log',
    title: 'Log',
    text: 'Requests timed out after release.',
  });
  return {
    store,
    close: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('output-limit feedback preserves a committed request and permits a pending brief', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_h, t) => action('request_information', { needId: 'timeout', question }, t),
      (h) => {
        assert.equal(
          result<{ persisted: boolean }>(h, 'request_information', 'call-1').persisted,
          true,
        );
        return lengthReply();
      },
      (h, t) => {
        assert.equal(
          result<{ persisted: boolean }>(h, 'request_information', 'call-1').persisted,
          true,
        );
        assert.ok(
          h.some(
            (message) =>
              message.role === 'user' &&
              /tool/i.test(message.content) &&
              /short|concise/i.test(message.content),
          ),
        );
        return action('read_record', { id: 'incident-log' }, t);
      },
      (h, t) => {
        result(h, 'request_information', 'call-1');
        const read = result<{ id: string; text: string }>(h, 'read_record', 'call-3');
        return action(
          'save_brief',
          {
            facts: [{ sources: [{ id: read.id, quote: read.text }] }],
            uncertainty: [],
            missing: [],
          },
          t,
        );
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'pending', checkpoint.reason ?? '');
    assert.equal(checkpoint.calls, 4);
    assert.equal(checkpoint.repairs, 1);
    const records = await f.store.list('incident');
    const requests = records.filter((record) => record.kind === 'request');
    const briefs = records.filter((record) => record.kind === 'brief');
    assert.equal(requests.length, 1);
    assert.equal(briefs.length, 1);
    assert.deepEqual(checkpoint.requestIds, [requests[0]!.id]);
    assert.ok(briefs[0]!.missing.includes(question));
  } finally {
    await f.close();
  }
});

test('repeated output-limit responses stop after one repair without saving a brief', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([() => lengthReply(), () => lengthReply()]);
    const checkpoint = await new Agent(f.store, model).run('incident', { maxRepairs: 2 });
    assert.equal(checkpoint.status, 'failed');
    assert.equal(checkpoint.calls, 2);
    assert.equal(checkpoint.repairs, 1);
    assert.equal(
      (await f.store.list('incident')).filter((record) => record.kind === 'brief').length,
      0,
    );
  } finally {
    await f.close();
  }
});
