import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, validateHistory } from '../src/context.js';
import { parseRecord } from '../src/records.js';
import type { Message } from '../src/qvac.js';

const base = {
  schemaVersion: 1,
  owner: 'a'.repeat(64),
  caseId: 'case',
  createdAt: '2026-10-31T00:00:00.000Z',
};
const records = [
  parseRecord({
    ...base,
    kind: 'case',
    id: 'case-record',
    title: 'Incident',
    task: 'Investigate marker.',
  }),
  parseRecord({
    ...base,
    kind: 'evidence',
    id: 'required',
    title: 'Log',
    text: 'The marker was amber.',
  }),
];
const common = {
  task: 'Investigate marker.',
  records,
  tools: [],
  selector: { select: async () => ({ ids: [], policy: 'omit' }) },
  requiredIds: ['required'],
  readIds: ['required'],
  signal: new AbortController().signal,
};
const group = (name: string, content: string): Message[] => [
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'draft', name, arguments: { draft: 'x'.repeat(1800) } }],
  },
  { role: 'tool', toolCallId: 'draft', toolName: name, content },
];
const error = JSON.stringify({ ok: false, code: 'QUOTE', feedback: 'Quote was not read.' });
const feedback = 'Quote was not read.';

test('protected read IDs and source survive discarding only a rejected draft under pressure', async () => {
  const history = group('save_brief', error),
    before = structuredClone(history);
  const baseline = await buildContext({ ...common, history: [], feedback, budget: 50000 });
  const budget = baseline.estimatedTokens + 64;
  const ample = await buildContext({
    ...common,
    history,
    feedback,
    discardRejectedDraft: true,
    budget: 50000,
  });
  assert.deepEqual(ample.history.slice(-2), history);
  const compact = await buildContext({
    ...common,
    history,
    feedback,
    discardRejectedDraft: true,
    budget,
  });
  assert.equal(compact.selection.historyGroupsDropped, 1);
  assert.ok(
    !compact.history.some(
      (m) => m.toolCallId === 'draft' || m.toolCalls?.some((c) => c.id === 'draft'),
    ),
  );
  validateHistory(compact.history);
  assert.deepEqual(history, before);
  const task = JSON.parse(compact.history[1]!.content);
  assert.deepEqual(task.readIds, ['required']);
  assert.match(task.readProgressGuidance, /not mean the whole source/i);
  assert.equal(task.feedback, feedback);
  assert.deepEqual(task.requiredEvidenceIds, ['required']);
  const index = JSON.parse(compact.history[2]!.content);
  assert.ok(
    index.evidenceIndex.some(
      (p: { sourceId: string; text: string }) =>
        p.sourceId === 'required' && p.text === 'The marker was amber.',
    ),
  );
  assert.match(index.evidenceAvailability.guidance, /find_evidence/);
  const absent = await buildContext({ ...common, readIds: undefined, history: [], budget: 50000 });
  assert.equal(Object.hasOwn(JSON.parse(absent.history[1]!.content), 'readIds'), false);
});

test('without explicit flag or nonempty feedback the latest rejected draft stays protected', async () => {
  const history = group('save_brief', error);
  const baseline = await buildContext({ ...common, history: [], feedback, budget: 50000 });
  const budget = baseline.estimatedTokens + 64;
  for (const opts of [
    { feedback, discardRejectedDraft: false },
    { feedback: '', discardRejectedDraft: true },
    { discardRejectedDraft: true },
  ]) {
    await assert.rejects(
      buildContext({ ...common, history, budget, ...opts }),
      (e: unknown) => (e as { code?: string }).code === 'CONTEXT_OVERFLOW',
    );
  }
});

test('successful, malformed, unrelated or unresolved groups are never discarded as rejected drafts', async () => {
  const baseline = await buildContext({ ...common, history: [], feedback, budget: 50000 });
  const budget = baseline.estimatedTokens + 64;
  for (const history of [
    group('save_brief', JSON.stringify({ ok: true, id: 'committed' })),
    group('save_brief', 'not json'),
    group('save_brief', JSON.stringify({ ok: false, code: 'TOOL_INFRASTRUCTURE' })),
    group('read_record', error),
  ]) {
    await assert.rejects(
      buildContext({ ...common, history, feedback, discardRejectedDraft: true, budget }),
      (e: unknown) => (e as { code?: string }).code === 'CONTEXT_OVERFLOW',
    );
  }
  const unresolved = group('save_brief', error).slice(0, 1);
  await assert.rejects(
    buildContext({ ...common, history: unresolved, feedback, discardRejectedDraft: true, budget }),
    (e: unknown) => (e as { code?: string }).code === 'PROTOCOL',
  );
});
