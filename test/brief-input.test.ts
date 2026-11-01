import test from 'node:test';
import assert from 'node:assert/strict';
import { toolSchema } from '@qvac/sdk';
import { parseQuotedBrief, quotedBriefParameters } from '../src/brief-input.js';

test('compiles exact source quotes into independent facts without changing source text', () => {
  const input = {
    quotes: { first: '  line one\n', second: 'exact "quote"' },
    uncertainty: [' uncertain '],
    missing: [],
  };
  assert.deepEqual(parseQuotedBrief(input), {
    facts: [
      { sources: [{ id: 'first', quote: '  line one\n' }] },
      { sources: [{ id: 'second', quote: 'exact "quote"' }] },
    ],
    uncertainty: ['uncertain'],
    missing: [],
  });
  assert.equal(input.quotes.first, '  line one\n');
  assert.deepEqual(
    parseQuotedBrief({ quotes: { unread: 'source text' }, uncertainty: [], missing: [] }).facts[0]!
      .sources[0]!.id,
    'unread',
  );
});

test('native schema enumerates read sources, requires mandatory IDs and passes SDK tool schema', () => {
  const params = quotedBriefParameters(['alpha', 'beta'], ['beta']);
  const properties = params.properties as Record<string, any>;
  assert.deepEqual(Object.keys(properties.quotes.properties), ['alpha', 'beta']);
  assert.deepEqual(properties.quotes.required, ['beta']);
  assert.equal(properties.quotes.additionalProperties, false);
  assert.equal(properties.quotes.minProperties, 1);
  assert.equal(properties.quotes.maxProperties, 32);
  assert.deepEqual(params.required, ['quotes', 'uncertainty', 'missing']);
  assert.equal(params.additionalProperties, false);
  assert.ok(
    toolSchema.safeParse({
      type: 'function',
      name: 'save_brief',
      description: 'Save observations',
      parameters: params,
    }).success,
  );
  assert.throws(() => quotedBriefParameters(['alpha'], ['beta']), /read/i);
  assert.throws(() => quotedBriefParameters(['alpha', 'alpha'], []), /duplicate/i);
  assert.throws(() => quotedBriefParameters(['alpha'], ['alpha', 'alpha']), /duplicate/i);
  assert.throws(() => quotedBriefParameters(['bad id'], []));
  const ids = Array.from({ length: 33 }, (_, i) => `id${i}`);
  assert.throws(() => quotedBriefParameters(ids, ids), /32/);
  assert.deepEqual(quotedBriefParameters(['beta', 'alpha'], ['beta']), params);
});

test('strict envelope rejects malformed keys, empty or oversized quotes, and invalid notes', () => {
  const good = { quotes: { a: 'quote' }, uncertainty: [], missing: [] };
  const invalid: unknown[] = [
    null,
    {},
    { ...good, extra: true },
    { ...good, quotes: {} },
    { ...good, quotes: { 'bad id': 'x' } },
    { ...good, quotes: { a: '' } },
    { ...good, quotes: { a: 'x'.repeat(1001) } },
    { ...good, quotes: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`id${i}`, 'x'])) },
    { ...good, uncertainty: [' '] },
    { ...good, missing: ['a', ' a '] },
    { ...good, missing: ['x'.repeat(401)] },
    { ...good, uncertainty: ['a', 'b', 'c', 'd'] },
  ];
  for (const value of invalid) assert.throws(() => parseQuotedBrief(value));
});
