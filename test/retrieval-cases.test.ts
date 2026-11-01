import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RETRIEVAL_CASES, RETRIEVAL_CASES_STABLE_ID, RETRIEVAL_FIXTURE_VERSION } from '../src/retrieval-cases.js';

test('frozen retrieval cases have valid, unambiguous annotations', () => {
  assert.equal(RETRIEVAL_FIXTURE_VERSION, 'retrieval-cases-v2');
  assert.equal(RETRIEVAL_CASES_STABLE_ID, '306b32f7ae3f22823f76e34d03cb07858ce1befd2e709949ade16784a56d2bf4');
  assert.equal(createHash('sha256').update(JSON.stringify(RETRIEVAL_CASES)).digest('hex'), RETRIEVAL_CASES_STABLE_ID);
  assert.equal(new Set(RETRIEVAL_CASES.map((c) => c.id)).size, RETRIEVAL_CASES.length);
  const allIds = new Set<string>();
  let total = 0;
  for (const c of RETRIEVAL_CASES) {
    assert.ok(c.id && c.family && c.task);
    assert.equal(new Set(c.requiredSourceIds).size, c.requiredSourceIds.length);
    assert.deepEqual(new Set(c.expectedSpans.map((s) => s.sourceId)), new Set(c.requiredSourceIds));
    for (const e of c.evidence) {
      assert.ok(e.id && e.title && e.text);
      assert.ok(!allIds.has(e.id));
      allIds.add(e.id);
      total += e.text.length;
    }
    for (const span of c.expectedSpans) {
      assert.ok(span.quote);
      const source = c.evidence.find((e) => e.id === span.sourceId);
      assert.ok(source?.text.includes(span.quote));
    }
  }
  assert.ok(total > 7000);
  assert.ok(RETRIEVAL_CASES.filter((c) => c.evidence.reduce((n, e) => n + e.text.length, 0) > 15000).length >= 4);
  assert.ok(RETRIEVAL_CASES.filter((c) => c.split === 'heldout').some((c) => c.evidence.reduce((n, e) => n + e.text.length, 0) > 15000));
  assert.ok(RETRIEVAL_CASES.every((c) => c.evidence.every((e) => e.text.length <= 16000)));
  assert.ok(RETRIEVAL_CASES.filter((c) => c.split === 'heldout').some((c) => c.expectedSpans.some((s) => c.evidence.find((e) => e.id === s.sourceId)!.text.indexOf(s.quote) > 2000)));
  assert.ok(RETRIEVAL_CASES.some((c) => c.expectedSpans.some((s) => c.evidence.find((e) => e.id === s.sourceId)!.text.indexOf(s.quote) > 2000)));
  const dev = new Set(RETRIEVAL_CASES.filter((c) => c.split === 'development').map((c) => c.family));
  assert.ok(RETRIEVAL_CASES.filter((c) => c.split === 'heldout').every((c) => !dev.has(c.family)));
  assert.ok(RETRIEVAL_CASES.some((c) => c.requiredSourceIds.length === 0));
});

test('conditional, negative, and unit-sensitive facts stay intact', () => {
  const quotes = RETRIEVAL_CASES.flatMap((c) => c.expectedSpans.map((s) => s.quote));
  assert.ok(quotes.includes('The vaccine cargo limit was 8 °C, not 8 °F.'));
  assert.ok(quotes.includes('When the connector is wet, do not energize the charging unit at any voltage.'));
  assert.ok(quotes.includes('After the connector is verified dry, the unit may operate at 48 V DC.'));
  assert.ok(quotes.includes('Do not release the shipment unless quality assurance signs the excursion review.'));
});



