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
    kind: 'evidence',
    id: 'required',
    title: 'Log',
    text: 'The marker was amber.',
  }),
];
const feedback = 'The submitted quote was not read.';
const common = {
  task: 'Investigate marker.',
  records,
  tools: [],
  selector: { select: async () => ({ ids: [], policy: 'omit' }) },
  requiredIds: ['required'],
  readIds: ['required'],
  signal: new AbortController().signal,
  feedback,
};
const group = (content: string): Message[] => [
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'draft', name: 'save_brief', arguments: { draft: 'x'.repeat(1800) } }],
  },
  { role: 'tool', toolCallId: 'draft', toolName: 'save_brief', content },
];
const task = (history: Message[]) => JSON.parse(history[1]!.content);

test('exact retained error feedback is referenced once while mandatory context is preserved', async () => {
  const history = group(JSON.stringify({ ok: false, code: 'QUOTE', feedback }));
  const before = structuredClone(history);
  const context = await buildContext({ ...common, history, budget: 50000 });
  const state = task(context.history);
  assert.equal(state.feedback, undefined);
  assert.equal(state.feedbackInToolResult, 'draft');
  assert.equal(context.history.filter((m) => m.content.includes(feedback)).length, 1);
  assert.deepEqual(state.readIds, ['required']);
  assert.deepEqual(state.requiredEvidenceIds, ['required']);
  assert.equal(state.readState, undefined);
  assert.equal(
    state.readProgressGuidance,
    'Required excerpts are available. Save citing every requiredEvidenceId; do not repeat those locations. An ID does not prove the whole source was read.',
  );
  assert.ok(
    JSON.parse(context.history[2]!.content).evidenceIndex.some(
      (p: { sourceId: string }) => p.sourceId === 'required',
    ),
  );
  assert.deepEqual(history, before);
  validateHistory(context.history);
});

test('nonmatching, malformed and successful results retain base feedback', async () => {
  for (const content of [
    JSON.stringify({ ok: false, feedback: 'stale' }),
    'not json',
    JSON.stringify({ ok: true, feedback }),
  ]) {
    const context = await buildContext({ ...common, history: group(content), budget: 50000 });
    assert.equal(task(context.history).feedback, feedback);
    assert.equal(task(context.history).feedbackInToolResult, undefined);
  }
  const partial = await buildContext({ ...common, readIds: [], history: [], budget: 50000 });
  assert.match(task(partial.history).readProgressGuidance, /Reuse prior reads/);
  assert.equal(task(partial.history).readState, undefined);
});

test('discarding rejected draft under pressure restores feedback in protected base', async () => {
  const history = group(JSON.stringify({ ok: false, code: 'QUOTE', feedback }));
  const baseline = await buildContext({ ...common, history: [], budget: 50000 });
  const context = await buildContext({
    ...common,
    history,
    budget: baseline.estimatedTokens + 32,
    discardRejectedDraft: true,
  });
  assert.equal(context.selection.historyGroupsDropped, 1);
  assert.equal(task(context.history).feedback, feedback);
  assert.equal(task(context.history).feedbackInToolResult, undefined);
  assert.deepEqual(task(context.history).requiredEvidenceIds, ['required']);
  validateHistory(context.history);
});
