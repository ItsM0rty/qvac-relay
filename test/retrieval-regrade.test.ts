import test from 'node:test';
import assert from 'node:assert/strict';
import { runRetrievalEvaluation, fixtureRecords, type RetrievalEvalRow } from '../src/retrieval-eval.js';
import { regradePassageReport } from '../src/retrieval-regrade.js';
import { RETRIEVAL_CASES } from '../src/retrieval-cases.js';
import { projectPassages } from '../src/retrieval.js';

const asSelection = (row: RetrievalEvalRow) => row.selection as { ids: string[]; fallback?: string; policy: string; usage?: unknown };
async function captured() {
  return runRetrievalEvaluation({ mode: 'retrieval', selectors: ['deterministic'], trials: 1, split: 'all', caseIds: ['dev-checkout-1', 'dev-db-1', 'dev-checkout-2', 'held-none-1'] });
}

test('regrade reconstructs recorded coverage, including null no-answer recall, without mutating input or inference', async () => {
  const input = await captured();
  for (const row of input.rows) {
    row.selected = { recall: 1, distractors: 0 };
    row.success = true;
  }
  const held = input.rows.find((r) => r.caseId === 'held-none-1')!;
  const heldFixture = RETRIEVAL_CASES.find((c) => c.id === held.caseId)!;
  asSelection(held).ids = [projectPassages(fixtureRecords(heldFixture))[0]!.id];
  const before = structuredClone(input);
  const report = regradePassageReport(input);
  assert.deepEqual(input, before);
  assert.equal(report.regrade.mode, 'recorded-passage-selection-regrade');
  assert.equal(report.regrade.nativeInference, false);
  for (const row of report.rows) {
    const entry = RETRIEVAL_CASES.find((e) => e.id === row.caseId)!;
    const selected = projectPassages(fixtureRecords(entry)).filter((p) => asSelection(row).ids.includes(p.id));
    const covered = entry.expectedSpans.filter((s) => selected.some((p) => p.sourceId === s.sourceId && p.text.includes(s.quote)));
    const distractors = selected.filter((p) => !entry.expectedSpans.some((s) => p.sourceId === s.sourceId && p.text.includes(s.quote))).length;
    const metrics = row.selected as { recall: number | null; covered: string[]; distractors: number };
    assert.equal(metrics.recall, entry.expectedSpans.length ? covered.length / entry.expectedSpans.length : null);
    assert.deepEqual(metrics.covered, covered.map((s) => s.sourceId));
    assert.equal(metrics.distractors, distractors);
    assert.equal(row.nativeRanking, false);
  }
  const regradedNone = report.rows.find((r) => r.caseId === 'held-none-1')!;
  assert.equal((regradedNone.selected as { recall: number | null }).recall, null);
  assert.equal((regradedNone.selected as { distractors: number }).distractors, 1);
  assert.equal(regradedNone.success, false);
});

test('a captured MiniLM fallback cannot become a successful native ranking even with full recall', async () => {
  const input = await captured();
  input.options.selectors = ['minilm'];
  for (const row of input.rows) row.selector = 'minilm';
  const row = input.rows.find((r) => r.caseId === 'dev-checkout-1')!;
  const entry = RETRIEVAL_CASES.find((e) => e.id === row.caseId)!;
  const passages = projectPassages(fixtureRecords(entry));
  asSelection(row).ids = entry.expectedSpans.map((s) => passages.find((p) => p.sourceId === s.sourceId && p.text.includes(s.quote))!.id);
  asSelection(row).fallback = 'MiniLM load failed';
  row.success = true;
  const before = structuredClone(input);
  const result = regradePassageReport(input).rows.find((r) => r.caseId === row.caseId)!;
  assert.deepEqual(input, before);
  assert.equal((result.selected as { recall: number }).recall, 1);
  assert.equal(result.nativeRanking, false);
  assert.equal(result.fallback, 'MiniLM load failed');
  assert.equal(result.success, false);
});

test('regrade rejects missing, duplicate, or unknown passage identities', async () => {
  const input = await captured();
  let broken = structuredClone(input);
  delete broken.rows[0]!.selection;
  assert.throws(() => regradePassageReport(broken), /selection/i);
  broken = structuredClone(input);
  asSelection(broken.rows[0]!).ids = ['not-a-passage'];
  assert.throws(() => regradePassageReport(broken), /unknown/i);
  broken = structuredClone(input);
  const ids = asSelection(broken.rows[0]!).ids;
  assert.ok(ids.length); ids.push(ids[0]!);
  assert.throws(() => regradePassageReport(broken), /duplicate/i);
});
