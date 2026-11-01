import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, validateHistory, INSTRUCTIONS } from '../src/context.js';
import { parseRecord } from '../src/records.js';
import type { Message } from '../src/qvac.js';

const base = {
  schemaVersion: 1,
  owner: 'a'.repeat(64),
  caseId: 'case',
  createdAt: '2026-10-31T00:00:00.000Z',
};
const need = { id: 'need-config', question: 'What configuration was deployed?' };
const records = [
  parseRecord({
    ...base,
    kind: 'case',
    id: 'case-record',
    title: 'Incident',
    task: 'Investigate amber marker.',
    informationNeeds: [need],
  }),
  parseRecord({
    ...base,
    kind: 'request',
    id: 'request-config',
    needId: need.id,
    question: need.question,
  }),
  parseRecord({
    ...base,
    kind: 'evidence',
    id: 'required-log',
    title: 'Log',
    text: 'The amber marker was observed.',
  }),
];
const selector = { select: async () => ({ ids: [], policy: 'omit' }) };
const group = (id: string, content: string): Message[] => [
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id, name: 'read_record', arguments: { id: 'required-log' } }],
  },
  { role: 'tool', content, toolCallId: id, toolName: 'read_record' },
];
const old = group('old-call', 'old resolved output '.repeat(120));
const latest = group('latest-call', 'latest resolved output');
const common = {
  task: 'Investigate amber marker.',
  records,
  tools: [],
  selector,
  requiredIds: ['required-log'],
  signal: new AbortController().signal,
};

test('drops only the oldest complete resolved group while preserving required context and latest protocol', async () => {
  const history = [...old, ...latest];
  const original = structuredClone(history);
  const one = await buildContext({ ...common, history: latest, budget: 50000 });
  const all = await buildContext({ ...common, history, budget: 50000 });
  const budget = one.estimatedTokens + 64;
  assert.ok(all.estimatedTokens > budget);
  const compacted = await buildContext({ ...common, history, budget });
  assert.ok(compacted.estimatedTokens <= budget);
  assert.equal((compacted.selection as { historyGroupsDropped?: number }).historyGroupsDropped, 1);
  assert.deepEqual(compacted.history.slice(-2), latest);
  assert.equal(
    compacted.history.some(
      (m) => m.toolCallId === 'old-call' || m.toolCalls?.some((c) => c.id === 'old-call'),
    ),
    false,
  );
  validateHistory(compacted.history);
  assert.deepEqual(history, original);
  assert.equal(compacted.history[0]!.content, INSTRUCTIONS);
  const task = JSON.parse(compacted.history[1]!.content);
  assert.equal(task.task, common.task);
  assert.deepEqual(task.requiredEvidenceIds, ['required-log']);
  assert.deepEqual(task.informationNeeds, [{ ...need, status: 'awaiting-response' }]);
  assert.ok(
    task.requests.some(
      (r: { needId?: string; question: string }) =>
        r.needId === need.id && r.question === need.question,
    ),
  );
  const evidence = JSON.parse(compacted.history[2]!.content).evidenceIndex;
  assert.ok(
    evidence.some(
      (p: { sourceId: string; text: string }) =>
        p.sourceId === 'required-log' && p.text === 'The amber marker was observed.',
    ),
  );
});

test('one oversized latest group raises context overflow instead of truncating protocol', async () => {
  const history = group('only-call', 'essential latest output '.repeat(100));
  const original = structuredClone(history);
  const full = await buildContext({ ...common, history, budget: 50000 });
  await assert.rejects(
    buildContext({ ...common, history, budget: full.estimatedTokens - 1 }),
    (e: unknown) => (e as { code?: string }).code === 'CONTEXT_OVERFLOW',
  );
  assert.deepEqual(history, original);
});
