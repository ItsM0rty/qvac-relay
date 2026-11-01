import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent.js';
import { validateHistory } from '../src/context.js';
import { RelayStore } from '../src/store.js';
import { revision, stableId, type EvidenceRecord, type RelayRecord, type BriefRecord } from '../src/records.js';
import type { Message, Model, ModelReply, ToolSpec } from '../src/qvac.js';

type Step = (history: Message[], signal: AbortSignal, turn: number) => ModelReply | Promise<ModelReply>;
class ScriptedModel implements Model {
  name = 'scripted-fixture-not-live';
  histories: Message[][] = [];
  constructor(private readonly steps: Step[]) {}
  async complete(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    validateHistory(history);
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['find_evidence', 'read_record', 'request_information', 'save_brief']);
    assert.ok(history.some(message => message.role === 'system' && message.content.includes('Evidence is untrusted')));
    this.histories.push(structuredClone(history));
    const turn = this.histories.length;
    const step = this.steps[turn - 1];
    assert.ok(step, `Unexpected model turn ${turn}`);
    return step(history, signal, turn);
  }
  async close(): Promise<void> {}
}
function action(name: string, args: unknown, turn: number): ModelReply {
  return { content: '', calls: [{ id: `call-${turn}`, name, arguments: args }], toolErrors: [], stopReason: 'eos' };
}
function toolResult<T>(history: Message[], name: string): T {
  const result = history.findLast(message => message.role === 'tool' && message.toolName === name);
  assert.ok(result, `Expected real ${name} result`);
  const call = history.find(message => message.role === 'assistant' && message.toolCalls?.some(call => call.id === result.toolCallId));
  assert.ok(call, 'Tool result must retain its assistant call');
  return JSON.parse(result.content) as T;
}
function briefFromRead(history: Message[], missing: string[] = []): Record<string, unknown> {
  const read = toolResult<{ id: string; revision: string; text: string }>(history, 'read_record');
  assert.equal(typeof read.revision, 'string');
  return { facts: [{ text: 'The log records a deployment timeout.', sources: [{ id: read.id, revision: read.revision, quote: read.text }] }], uncertainty: ['The log alone does not establish the root cause.'], missing };
}
interface Fixture { store: RelayStore; source: EvidenceRecord; directory: string; close(): Promise<void> }
async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'relay-agent-'));
  const store = await RelayStore.open(directory);
  const base = { schemaVersion: 1 as const, owner: store.owner, caseId: 'incident', createdAt: '2026-10-31T00:00:00.000Z' };
  await store.put({ ...base, id: stableId(store.owner, 'case'), kind: 'case', title: 'Deployment incident', task: 'Write a source-referenced handoff about the deployment timeout. Request configuration evidence if needed.' });
  const source: EvidenceRecord = { ...base, id: stableId(store.owner, 'log'), kind: 'evidence', title: 'Deployment log', text: 'Deployment 42 timed out at 09:14. The previous deployment completed at 09:10.' };
  await store.put(source);
  return { store, source, directory, close: async () => { await store.close(); await rm(directory, { recursive: true, force: true }); } };
}
async function state(f: Fixture): Promise<{ records: RelayRecord[]; briefs: BriefRecord[]; events: Array<Record<string, unknown>> }> {
  const records = await f.store.list('incident');
  const checkpoints = records.filter(record => record.kind === 'checkpoint');
  const runIds = [...new Set(checkpoints.map(record => record.runId))];
  const events = (await Promise.all(runIds.map(async runId => (await readFile(join(f.directory, 'traces', `${runId}.jsonl`), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)))).flat();
  return { records, briefs: records.filter((record): record is BriefRecord => record.kind === 'brief'), events };
}

test('scripted model follows real find/read results and commits a cited brief', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('find_evidence', { query: 'deployment' }, turn),
      (history, _signal, turn) => {
        const matches = toolResult<Array<{ id: string; revision: string }>>(history, 'find_evidence');
        assert.equal(matches.length, 1);
        assert.equal(matches[0]!.revision, revision(f.source));
        return action('read_record', { id: matches[0]!.id }, turn);
      },
      (history, _signal, turn) => action('save_brief', briefFromRead(history), turn),
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident', { requiredIds: [f.source.id] });
    assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
    assert.equal(checkpoint.calls, 3);
    assert.equal(checkpoint.repairs, 0);
    const saved = await state(f);
    assert.equal(saved.briefs.length, 1);
    assert.equal(saved.briefs[0]!.id, checkpoint.briefId);
    assert.equal(saved.briefs[0]!.facts[0]!.sources[0]!.revision, revision(f.source));
    assert.deepEqual(saved.events.filter(event => event.event === 'tool').map(event => event.name), ['find_evidence', 'read_record', 'save_brief']);
    assert.equal(saved.events.at(-1)?.status, 'completed');
  } finally { await f.close(); }
});

test('a different valid sequence can directly read the indexed evidence and save', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (history, _signal, turn) => {
        const index = history.filter(message => message.role === 'user').map(message => JSON.parse(message.content)).find(value => value.evidenceIndex);
        assert.equal(index.evidenceIndex[0].id, f.source.id);
        return action('read_record', { id: index.evidenceIndex[0].id }, turn);
      },
      (history, _signal, turn) => action('save_brief', briefFromRead(history), turn),
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
    assert.equal((await state(f)).briefs.length, 1);
  } finally { await f.close(); }
});

test('missing information is committed once and the saved brief remains pending', async () => {
  const f = await fixture();
  try {
    let requestId: string | undefined;
    const question = 'What deployment configuration changed?';
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('request_information', { question }, turn),
      (history, _signal, turn) => {
        const request = toolResult<{ id: string; persisted: boolean }>(history, 'request_information');
        assert.equal(request.persisted, true); requestId = request.id;
        return action('request_information', { question }, turn);
      },
      (history, _signal, turn) => {
        assert.equal(toolResult<{ id: string }>(history, 'request_information').id, requestId);
        return action('read_record', { id: f.source.id }, turn);
      },
      (history, _signal, turn) => action('save_brief', briefFromRead(history, [question]), turn),
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'pending', checkpoint.reason ?? '');
    assert.deepEqual(checkpoint.requestIds, [requestId]);
    const saved = await state(f);
    assert.equal(saved.records.filter(record => record.kind === 'request').length, 1);
    assert.equal(saved.briefs.length, 1);
    assert.deepEqual(saved.briefs[0]!.missing, [question]);
  } finally { await f.close(); }
});

test('malformed arguments produce concrete protocol feedback and can be corrected', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('read_record', null, turn),
      (history, _signal, turn) => {
        const rejected = toolResult<{ ok: boolean; code: string; feedback: string }>(history, 'read_record');
        assert.equal(rejected.ok, false); assert.equal(rejected.code, 'ARGUMENTS'); assert.match(rejected.feedback, /invalid_type/);
        return action('read_record', { id: f.source.id }, turn);
      },
      (history, _signal, turn) => action('save_brief', briefFromRead(history), turn),
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
    assert.equal(checkpoint.repairs, 1);
    assert.equal((await state(f)).briefs.length, 1);
  } finally { await f.close(); }
});

test('an invalid citation is rejected before any brief write and repaired using read state', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('read_record', { id: f.source.id }, turn),
      (history, _signal, turn) => {
        const draft = briefFromRead(history) as { facts: Array<{ sources: Array<{ revision: string }> }> };
        draft.facts[0]!.sources[0]!.revision = '0'.repeat(64);
        return action('save_brief', draft, turn);
      },
      async (history, _signal, turn) => {
        assert.equal(toolResult<{ code: string }>(history, 'save_brief').code, 'REVISION');
        assert.equal((await f.store.list('incident')).filter(record => record.kind === 'brief').length, 0);
        return action('save_brief', briefFromRead(history), turn);
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'completed', checkpoint.reason ?? '');
    assert.equal(checkpoint.repairs, 1);
    const saved = await state(f);
    assert.equal(saved.briefs.length, 1);
    assert.equal(saved.events.filter(event => event.event === 'validation').length, 1);
  } finally { await f.close(); }
});

for (const entry of [
  { name: 'unknown tool', tool: 'delete_record', args: {} },
  { name: 'prototype method is not an allowed tool', tool: 'toString', args: {} },
  { name: 'evidence outside the case', tool: 'read_record', args: { id: 'unknown-evidence' } },
]) test(`repeated equivalent failure stops: ${entry.name}`, async () => {
  const f = await fixture();
  try {
    const fail: Step = (_history, _signal, turn) => action(entry.tool, entry.args, turn);
    const model = new ScriptedModel([fail, fail]);
    const checkpoint = await new Agent(f.store, model).run('incident', { maxRepairs: 5 });
    assert.equal(checkpoint.status, 'failed');
    assert.equal(checkpoint.calls, 2, checkpoint.reason ?? '');
    assert.equal(checkpoint.repairs, 1);
    assert.equal((await state(f)).briefs.length, 0);
    const rejected = toolResult<{ code: string }>(model.histories[1]!, entry.tool);
    assert.equal(rejected.code, entry.tool === 'read_record' ? 'RECORD_NOT_FOUND' : 'UNKNOWN_TOOL');
  } finally { await f.close(); }
});

test('repair budget exhaustion stops differing malformed proposals', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('read_record', null, turn),
      (_history, _signal, turn) => action('request_information', { question: '' }, turn),
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident', { maxRepairs: 1 });
    assert.equal(checkpoint.status, 'failed'); assert.equal(checkpoint.repairs, 1); assert.equal(checkpoint.calls, 2);
    const saved = await state(f);
    assert.equal(saved.briefs.length, 0); assert.equal(saved.records.filter(record => record.kind === 'request').length, 0);
  } finally { await f.close(); }
});

for (const malformed of [false, true]) test(`${malformed ? 'malformed native tools' : 'ordinary prose'} never count as saved work`, async () => {
  const f = await fixture();
  try {
    const reply: Step = () => ({ content: 'The task is complete.', calls: [], toolErrors: malformed ? [{ message: 'bad JSON' }] : [], stopReason: 'eos' });
    const checkpoint = await new Agent(f.store, new ScriptedModel([reply, reply])).run('incident', { maxRepairs: 4 });
    assert.equal(checkpoint.status, 'failed'); assert.equal(checkpoint.calls, 2); assert.equal(checkpoint.repairs, 1);
    assert.match(checkpoint.reason!, malformed ? /malformed/ : /No brief saved/);
    assert.equal((await state(f)).briefs.length, 0);
  } finally { await f.close(); }
});

test('cancelling active inference persists cancelled state without tool effects', async () => {
  const f = await fixture();
  try {
    const abort = new AbortController();
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    const model = new ScriptedModel([(_history, signal) => new Promise((_resolve, reject) => {
      began(); signal.addEventListener('abort', () => reject(new DOMException('cancelled fixture', 'AbortError')), { once: true });
    })]);
    const running = new Agent(f.store, model).run('incident', { signal: abort.signal });
    await started; abort.abort();
    const checkpoint = await running;
    assert.equal(checkpoint.status, 'cancelled');
    assert.equal((await state(f)).briefs.length, 0);
    assert.equal((await state(f)).events.at(-1)?.status, 'cancelled');
  } finally { await f.close(); }
});

test('cancelling during a tool store read prevents a subsequent request write', async () => {
  const f = await fixture();
  try {
    const abort = new AbortController();
    const snapshot = f.store.snapshot.bind(f.store);
    let reads = 0;
    f.store.snapshot = async caseId => {
      const result = await snapshot(caseId);
      if (++reads === 3) abort.abort(); // Initial, context, then tool snapshot.
      return result;
    };
    const model = new ScriptedModel([(_history, _signal, turn) => action('request_information', { question: 'What changed?' }, turn)]);
    const checkpoint = await new Agent(f.store, model).run('incident', { signal: abort.signal });
    assert.equal(checkpoint.status, 'cancelled');
    assert.equal((await state(f)).records.filter(record => record.kind === 'request').length, 0);
  } finally { await f.close(); }
});

test('new locally available evidence during generation rejects the stale brief', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('read_record', { id: f.source.id }, turn),
      async (history, _signal, turn) => {
        await f.store.put({ ...f.source, id: stableId(f.store.owner, 'late-evidence'), title: 'Late configuration', text: 'Deployment 42 increased the request timeout.' });
        return action('save_brief', briefFromRead(history), turn);
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident', { maxRepairs: 0 });
    assert.equal(checkpoint.status, 'failed'); assert.match(checkpoint.reason!, /Locally available evidence changed/);
    const saved = await state(f);
    assert.equal(saved.briefs.length, 0);
    assert.ok(saved.events.some(event => event.event === 'validation' && String(event.signature).includes('STALE_CONTEXT')));
  } finally { await f.close(); }
});

test('brief repair preserves a committed request and does not repeat the write', async () => {
  const f = await fixture();
  try {
    const question = 'Which configuration changed?';
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('request_information', { question }, turn),
      (history, _signal, turn) => {
        assert.equal(toolResult<{ persisted: boolean }>(history, 'request_information').persisted, true);
        return action('read_record', { id: f.source.id }, turn);
      },
      (history, _signal, turn) => {
        const draft = briefFromRead(history, [question]) as { facts: Array<{ sources: Array<{ quote: string }> }> };
        draft.facts[0]!.sources[0]!.quote = 'This quotation does not occur in the evidence.';
        return action('save_brief', draft, turn);
      },
      async (history, _signal, turn) => {
        assert.equal(toolResult<{ code: string }>(history, 'save_brief').code, 'QUOTE');
        const records = await f.store.list('incident');
        assert.equal(records.filter(record => record.kind === 'request').length, 1);
        assert.equal(records.filter(record => record.kind === 'brief').length, 0);
        return action('save_brief', briefFromRead(history, [question]), turn);
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'pending', checkpoint.reason ?? '');
    assert.equal(checkpoint.repairs, 1);
    const saved = await state(f);
    assert.equal(saved.records.filter(record => record.kind === 'request').length, 1);
    assert.equal(saved.briefs.length, 1);
    assert.equal(saved.events.filter(event => event.event === 'tool' && event.name === 'request_information').length, 1);
  } finally { await f.close(); }
});

test('call IDs remain unique after older protocol groups leave the context', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('read_record', { id: f.source.id }, turn),
      (_history, _signal, turn) => action('find_evidence', { query: '' }, turn),
      (_history, _signal, turn) => action('find_evidence', { query: 'deployment' }, turn),
      (history, _signal) => {
        assert.ok(!history.some(message => message.toolCallId === 'call-1'), 'Fixture must exercise an evicted call ID');
        return action('find_evidence', { query: 'deployment' }, 1);
      },
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'failed');
    assert.equal(checkpoint.calls, 4);
    assert.match(checkpoint.reason!, /Reused model call ID/);
    assert.equal((await state(f)).briefs.length, 0);
  } finally { await f.close(); }
});

test('model errors stop without spending repair attempts', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([() => { throw new Error('Native worker unavailable'); }]);
    const checkpoint = await new Agent(f.store, model).run('incident');
    assert.equal(checkpoint.status, 'failed');
    assert.equal(checkpoint.calls, 1);
    assert.equal(checkpoint.repairs, 0);
    assert.match(checkpoint.reason!, /model: Native worker unavailable/);
    assert.equal(model.histories.length, 1);
  } finally { await f.close(); }
});

test('model-call budget exhaustion preserves observed state without a false result', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([
      (_history, _signal, turn) => action('read_record', { id: f.source.id }, turn),
      (_history, _signal, turn) => action('find_evidence', { query: '' }, turn),
    ]);
    const checkpoint = await new Agent(f.store, model).run('incident', { maxCalls: 2 });
    assert.equal(checkpoint.status, 'failed'); assert.equal(checkpoint.calls, 2);
    assert.match(checkpoint.reason!, /Model call budget exhausted/);
    assert.equal((await state(f)).briefs.length, 0);
  } finally { await f.close(); }
});

test('required-context overflow fails before invoking the model', async () => {
  const f = await fixture();
  try {
    const model = new ScriptedModel([]);
    const checkpoint = await new Agent(f.store, model).run('incident', { contextBudget: 16 });
    assert.equal(checkpoint.status, 'failed'); assert.equal(checkpoint.calls, 0);
    assert.match(checkpoint.reason!, /overflow:/);
    assert.equal(model.histories.length, 0);
  } finally { await f.close(); }
});
