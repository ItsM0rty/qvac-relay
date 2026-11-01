import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, validateHistory } from '../src/context.js';
import { parseRecord, revision } from '../src/records.js';
import type { Message } from '../src/qvac.js';

const base = {
  schemaVersion: 1,
  owner: 'a'.repeat(64),
  caseId: 'case',
  createdAt: '2026-10-31T00:00:00.000Z',
};
const source = parseRecord({
  ...base,
  kind: 'evidence',
  id: 'source',
  title: 'Log',
  text: 'The amber marker was observed.',
});
const selector = { select: async () => ({ ids: [], policy: 'omit' }) };
const common = {
  task: 'amber marker',
  records: [source],
  tools: [],
  selector,
  requiredIds: ['source'],
  signal: new AbortController().signal,
};
const valid = {
  id: 'source',
  revision: revision(source),
  offset: 0,
  end: source.kind === 'evidence' ? source.text.length : 0,
  text: source.kind === 'evidence' ? source.text : '',
};
const group = (id: string, content: string): Message[] => [
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id, name: 'read_record', arguments: { id: 'source' } }],
  },
  { role: 'tool', toolCallId: id, toolName: 'read_record', content },
];
const index = (h: Message[]) =>
  JSON.parse(h.find((m) => m.role === 'user' && m.content.includes('evidenceIndex'))!.content)
    .evidenceIndex[0] as {
    id: string;
    sourceId: string;
    revision: string;
    text: string;
    start: number;
    end: number;
    textInToolResult?: string;
  };

test('full exact retained read projects only the duplicate required text and preserves metadata', async () => {
  const history = group('read-one', JSON.stringify(valid));
  const before = structuredClone(history);
  const context = await buildContext({ ...common, history, budget: 50000 });
  const p = index(context.history);
  assert.equal(p.id, 'source');
  assert.equal(p.sourceId, 'source');
  assert.equal(p.revision, revision(source));
  assert.equal(p.text, '');
  assert.equal(p.textInToolResult, 'read-one');
  assert.equal(p.start, 0);
  assert.equal(p.end, valid.end);
  assert.deepEqual(history, before);
  validateHistory(context.history);
  assert.equal(JSON.parse(context.history.at(-1)!.content).text, valid.text);
});

test('partial, stale, malformed and incorrect reads cannot suppress source text', async () => {
  for (const body of [
    { ...valid, end: valid.end - 1, text: valid.text.slice(0, -1) },
    { ...valid, revision: 'b'.repeat(64) },
    { ...valid, id: 'another' },
    { ...valid, text: 'x'.repeat(valid.text.length) },
    { ...valid, end: valid.end + 1 },
    '{not json',
  ]) {
    const context = await buildContext({
      ...common,
      history: group('read-one', typeof body === 'string' ? body : JSON.stringify(body)),
      budget: 50000,
    });
    const p = index(context.history);
    assert.equal(p.text, valid.text);
    assert.equal(p.textInToolResult, undefined);
  }
});

test('pruning a covering old group restores required passage text', async () => {
  const old = group('old', JSON.stringify({ ...valid, padding: 'x'.repeat(2500) }));
  const latest = group('latest', JSON.stringify({ ok: false, code: 'READ_LOCATION' }));
  const only = await buildContext({ ...common, history: latest, budget: 50000 });
  const history = [...old, ...latest],
    before = structuredClone(history);
  const result = await buildContext({ ...common, history, budget: only.estimatedTokens + 32 });
  assert.equal(result.selection.historyGroupsDropped, 1);
  assert.equal(index(result.history).text, valid.text);
  assert.equal(index(result.history).textInToolResult, undefined);
  assert.deepEqual(result.history.slice(-2), latest);
  assert.deepEqual(history, before);
  validateHistory(result.history);
});
