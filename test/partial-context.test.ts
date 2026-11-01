import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent.js';
import { buildContext, validateHistory } from '../src/context.js';
import { projectPassages } from '../src/retrieval.js';
import { revision, type EvidenceRecord } from '../src/records.js';
import { RelayStore } from '../src/store.js';
import type { Message, Model, ModelReply, ToolSpec } from '../src/qvac.js';

const base = {
  schemaVersion: 1 as const,
  owner: 'a'.repeat(64),
  caseId: 'case',
  createdAt: '2026-10-31T00:00:00.000Z',
};
const source: EvidenceRecord = {
  ...base,
  kind: 'evidence',
  id: 'long',
  title: 'Long log',
  text: `${'Ordinary checks were logged. '.repeat(75)}The zircon marker was amber.`,
};
const other: EvidenceRecord = {
  ...base,
  kind: 'evidence',
  id: 'other',
  title: 'Other log',
  text: 'A separate observation.',
};
const omit = { select: async () => ({ ids: [], policy: 'omit-test' }) };
function index(history: Message[]) {
  const item = history.find((m) => m.role === 'user' && m.content.includes('evidenceAvailability'));
  assert.ok(item);
  return JSON.parse(item.content) as {
    evidenceAvailability: {
      sources: number;
      passages: number;
      shown: number;
      omitted: number;
      guidance: string;
    };
    evidenceIndex: Array<{
      sourceId: string;
      revision: string;
      text: string;
      start: number;
      end: number;
    }>;
  };
}

test('availability counts all accepted passages even when selector omits everything; required context stays protected', async () => {
  const records = [source, other];
  const before = structuredClone(records);
  const passages = projectPassages(records);
  const args = {
    task: 'zircon marker',
    records,
    history: [],
    tools: [],
    selector: omit,
    signal: new AbortController().signal,
  };
  const omitted = index((await buildContext(args)).history);
  assert.deepEqual(
    [
      omitted.evidenceAvailability.sources,
      omitted.evidenceAvailability.passages,
      omitted.evidenceAvailability.shown,
      omitted.evidenceAvailability.omitted,
    ],
    [2, passages.length, 0, passages.length],
  );
  assert.deepEqual(omitted.evidenceIndex, []);
  assert.match(omitted.evidenceAvailability.guidance, /find_evidence/);
  const required = index((await buildContext({ ...args, requiredIds: [source.id] })).history);
  assert.deepEqual(
    [
      required.evidenceAvailability.sources,
      required.evidenceAvailability.passages,
      required.evidenceAvailability.shown,
      required.evidenceAvailability.omitted,
    ],
    [2, passages.length, 1, passages.length - 1],
  );
  assert.equal(required.evidenceIndex[0]!.sourceId, source.id);
  assert.equal(required.evidenceIndex[0]!.revision, revision(source));
  assert.equal(
    required.evidenceIndex[0]!.text,
    source.text.slice(required.evidenceIndex[0]!.start, required.evidenceIndex[0]!.end),
  );
  assert.ok(required.evidenceIndex[0]!.text.includes('zircon marker'));
  assert.deepEqual(records, before);
  await assert.rejects(
    buildContext({ ...args, requiredIds: [source.id], budget: 10 }),
    (e: unknown) => (e as { code?: string }).code === 'CONTEXT_OVERFLOW',
  );
});

type Step = (history: Message[], tools: ToolSpec[], turn: number) => ModelReply;
class ControlledModel implements Model {
  name = 'partial-context-test-not-live';
  private turn = 0;
  constructor(
    private readonly expectedNeeds: string[],
    private readonly steps: Step[],
  ) {}
  async complete(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    signal.throwIfAborted();
    validateHistory(history);
    const schema = tools.find((t) => t.name === 'request_information')!.parameters as {
      properties: Record<string, { enum?: string[] }>;
    };
    if (this.expectedNeeds.length)
      assert.deepEqual(schema.properties.needId?.enum, this.expectedNeeds);
    else assert.equal(Object.hasOwn(schema.properties, 'needId'), false);
    const step = this.steps[this.turn++];
    assert.ok(step);
    return step(history, tools, this.turn);
  }
  async close() {}
}
const action = (name: string, args: unknown, turn: number): ModelReply => ({
  content: '',
  calls: [{ id: `c-${turn}`, name, arguments: args }],
  toolErrors: [],
  stopReason: 'eos',
});
function result<T>(history: Message[], name: string): T {
  const m = history.findLast((x) => x.role === 'tool' && x.toolName === name);
  assert.ok(m);
  return JSON.parse(m.content) as T;
}
const save = (read: { id: string; text: string }) => ({
  facts: [{ sources: [{ id: read.id, quote: read.text }] }],
  uncertainty: [],
  missing: [],
});
async function runCase(withNeed: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-partial-'));
  const store = await RelayStore.open(dir);
  try {
    const recordBase = { ...base, owner: store.owner };
    const need = { id: 'need-setting', question: 'What setting was deployed?' };
    await store.put({
      ...recordBase,
      kind: 'case',
      id: 'case-record',
      title: 'Incident',
      task: 'Investigate the observation.',
      ...(withNeed ? { informationNeeds: [need] } : {}),
    });
    await store.put({
      ...recordBase,
      kind: 'evidence',
      id: 'log',
      title: 'Log',
      text: 'The observed marker was amber.',
    });
    const steps: Step[] = withNeed
      ? [
          (_h, _tools, t) =>
            action('request_information', { needId: 'unknown', question: 'Unknown?' }, t),
          (h, _tools, t) => {
            assert.equal(
              result<{ code: string }>(h, 'request_information').code,
              'INFORMATION_NEED',
            );
            return action('request_information', { needId: need.id, question: need.question }, t);
          },
          (h, _tools, t) => {
            assert.equal(
              result<{ status: string }>(h, 'request_information').status,
              'awaiting-response',
            );
            return action('read_record', { id: 'log' }, t);
          },
          (h, _tools, t) => action('save_brief', save(result(h, 'read_record')), t),
        ]
      : [
          (_h, _tools, t) => action('read_record', { id: 'log' }, t),
          (h, _tools, t) => action('save_brief', save(result(h, 'read_record')), t),
        ];
    const checkpoint = await new Agent(
      store,
      new ControlledModel(withNeed ? [need.id] : [], steps),
    ).run('case');
    assert.equal(checkpoint.status, withNeed ? 'pending' : 'completed', checkpoint.reason ?? '');
    const records = await store.list('case');
    const brief = records.find((r) => r.kind === 'brief');
    assert.ok(brief && brief.kind === 'brief');
    assert.equal(brief.facts[0]!.sources[0]!.quote, 'The observed marker was amber.');
    if (withNeed) assert.ok(records.some((r) => r.kind === 'request' && r.needId === need.id));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('offered tool schemas omit needId with no needs and allow a quoted brief', async () => {
  await runCase(false);
});
test('offered tool schemas enumerate declared need IDs; unknown IDs are rejected and the required request can be saved pending', async () => {
  await runCase(true);
});
