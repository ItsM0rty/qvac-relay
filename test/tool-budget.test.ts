import test from 'node:test';
import assert from 'node:assert/strict';
import { fitsToolResult } from '../src/tool-budget.js';
import { buildContext } from '../src/context.js';
import { parseRecord } from '../src/records.js';
import type { Message, ToolCall } from '../src/qvac.js';

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
    text: 'Required observation.',
  }),
];
const calls: ToolCall[] = [
  { id: 'one', name: 'read_record', arguments: { id: 'required' } },
  { id: 'two', name: 'read_record', arguments: { id: 'required' } },
];
const assistant: Message = { role: 'assistant', content: '', toolCalls: calls };
const result = (content: string): Message => ({
  role: 'tool',
  toolCallId: 'one',
  toolName: 'read_record',
  content,
});
const common = {
  task: 'Investigate.',
  records,
  requiredIds: ['required'],
  readIds: ['required'],
  tools: [],
  assistant,
  results: [result('{}')],
  remainingCalls: [calls[1]!],
  budget: 50000,
  signal: new AbortController().signal,
};

test('accounts for actual JSON-escaped UTF-8 and future tool placeholders at the protected budget boundary', async () => {
  const content = JSON.stringify({ text: '"\\\n雪'.repeat(180) });
  const results = [result(content)];
  const placeholder: Message = {
    role: 'tool',
    toolCallId: 'two',
    toolName: 'read_record',
    content: '{}',
  };
  const measured = await buildContext({
    task: common.task,
    records,
    requiredIds: common.requiredIds,
    readIds: common.readIds,
    tools: [],
    history: [assistant, ...results, placeholder],
    selector: { select: async () => ({ ids: [], policy: 'omit' }) },
    budget: 50000,
    signal: common.signal,
  });
  assert.equal(
    await fitsToolResult({ ...common, results, budget: measured.estimatedTokens }),
    true,
  );
  assert.equal(
    await fitsToolResult({ ...common, results, budget: measured.estimatedTokens - 1 }),
    false,
  );
  assert.equal(await fitsToolResult(common), true);
  const withoutRequired = await buildContext({
    task: common.task,
    records,
    readIds: common.readIds,
    tools: [],
    history: [assistant, ...results, placeholder],
    selector: { select: async () => ({ ids: [], policy: 'omit' }) },
    budget: 50000,
    signal: common.signal,
  });
  assert.ok(measured.estimatedTokens > withoutRequired.estimatedTokens);
  assert.equal(
    await fitsToolResult({ ...common, results, budget: withoutRequired.estimatedTokens }),
    false,
  );
});

test('protocol mismatches, missing required records and cancellation propagate instead of returning false', async () => {
  await assert.rejects(
    fitsToolResult({ ...common, remainingCalls: [] }),
    (e: unknown) => (e as { code?: string }).code === 'PROTOCOL',
  );
  await assert.rejects(
    fitsToolResult({ ...common, results: [{ ...result('{}'), toolCallId: 'other' }] }),
    (e: unknown) => (e as { code?: string }).code === 'PROTOCOL',
  );
  await assert.rejects(
    fitsToolResult({ ...common, requiredIds: ['missing'] }),
    (e: unknown) => (e as { code?: string }).code === 'MISSING_REQUIRED',
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fitsToolResult({ ...common, signal: controller.signal }),
    (e: unknown) => (e as { code?: string }).code === 'CANCELLED',
  );
});
