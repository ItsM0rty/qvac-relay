import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  fixtureRecords,
  runRetrievalEvaluation,
  validateRetrievalReport,
  type RetrievalEvalReport,
  type RetrievalEvaluationOptions,
} from '../src/retrieval-eval.js';
import { RETRIEVAL_CASES } from '../src/retrieval-cases.js';
import { lexicalRetrieve, projectPassages } from '../src/retrieval.js';

const options: RetrievalEvaluationOptions = {
  mode: 'retrieval',
  selectors: ['deterministic'],
  trials: 1,
  split: 'development',
};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = (report: RetrievalEvalReport) => structuredClone(report);
const shouldReject = (report: RetrievalEvalReport) =>
  assert.throws(() => validateRetrievalReport(report));

test('deterministic retrieval reports real passage coverage and distractors without claiming model inference', async () => {
  const report = await runRetrievalEvaluation(options);
  assert.equal(validateRetrievalReport(report), report);
  assert.equal(report.rows.length, 3);
  for (const row of report.rows) {
    const entry = RETRIEVAL_CASES.find((e) => e.id === row.caseId)!;
    const passages = projectPassages(fixtureRecords(entry));
    const lexical = lexicalRetrieve(entry.task, passages, 12).map((p) => p.passage);
    const selection = row.selection as { ids: string[]; policy: string };
    const selected = passages.filter((p) => selection.ids.includes(p.id));
    const expected = (ps: typeof passages) => ({
      recall: entry.expectedSpans.length
        ? entry.expectedSpans.filter((s) =>
            ps.some((p) => p.sourceId === s.sourceId && p.text.includes(s.quote)),
          ).length / entry.expectedSpans.length
        : null,
      distractors: ps.filter(
        (p) =>
          !entry.expectedSpans.some((s) => p.sourceId === s.sourceId && p.text.includes(s.quote)),
      ).length,
    });
    assert.equal(row.executionSucceeded, true, String(row.failure));
    assert.equal(row.success, expected(selected).recall === 1);
    assert.equal(selection.policy, 'lexical-v1');
    assert.equal((row.lexical as { recall: number }).recall, expected(lexical).recall);
    assert.equal(
      (row.lexical as { distractors: number }).distractors,
      expected(lexical).distractors,
    );
    assert.equal((row.selected as { recall: number }).recall, expected(selected).recall);
    assert.equal(
      (row.selected as { distractors: number }).distractors,
      expected(selected).distractors,
    );
    assert.equal(row.generatorUsage, undefined);
    assert.equal(row.outcome, undefined);
    assert.equal(row.storedOutcome, undefined);
    assert.equal(row.warmUsage, null);
  }
  assert.match(report.mode, /retrieval/);
  assert.ok(report.limitations.some((s) => /not semantic truth/i.test(s)));
  const none = await runRetrievalEvaluation({
    ...options,
    split: 'heldout',
    caseIds: ['held-none-1'],
  });
  assert.equal(
    (none.rows[0]!.selected as { noRelevantOptional: boolean }).noRelevantOptional,
    true,
  );
  assert.equal((none.rows[0]!.lexical as { noRelevantOptional: boolean }).noRelevantOptional, true);
  assert.equal(none.rows[0]!.outcome, undefined);
  assert.equal((none.rows[0]!.selected as { recall: null }).recall, null);
  assert.equal(none.rows[0]!.success, false);
});

test('validator rejects missing, duplicate and unknown case, trial, selector and configuration identities', async () => {
  const original = await runRetrievalEvaluation(options);
  let report = clone(original);
  report.rows.pop();
  shouldReject(report);
  report = clone(original);
  report.rows.push(structuredClone(report.rows[0]!));
  shouldReject(report);
  report = clone(original);
  report.cases.push(report.cases[0]!);
  shouldReject(report);
  report = clone(original);
  report.options.selectors.push('deterministic');
  shouldReject(report);
  report = clone(original);
  report.rows[0]!.trial = 2;
  shouldReject(report);
  report = clone(original);
  report.rows[0]!.selector = 'laya';
  shouldReject(report);
  report = clone(original);
  report.rows[0]!.caseId = 'unknown-case';
  shouldReject(report);
  report = clone(original);
  report.cases[0] = 'unknown-case';
  report.rows[0]!.caseId = 'unknown-case';
  shouldReject(report);
  report = clone(original);
  report.cases.pop();
  report.rows.pop();
  shouldReject(report);
  report = clone(original);
  report.configurationHash = 'incorrect';
  shouldReject(report);
  report = clone(original);
  report.configuration.datasetHash = 'unknown-dataset';
  report.configurationHash = sha(report.configuration);
  shouldReject(report);
  report = clone(original);
  report.configuration.contextBudget++;
  report.configurationHash = sha(report.configuration);
  shouldReject(report);
});

test('validator and runner reject out-of-bounds or inconsistent options', async () => {
  const original = await runRetrievalEvaluation(options);
  for (const trials of [0, -1, 1.5, 4]) {
    const report = clone(original);
    report.options.trials = trials;
    report.rows = [];
    shouldReject(report);
    await assert.rejects(runRetrievalEvaluation({ ...options, trials }));
  }
  let report = clone(original);
  report.options.selectors = [];
  report.rows = [];
  shouldReject(report);
  report = clone(original);
  report.options.split = 'heldout';
  shouldReject(report);
  report = clone(original);
  report.options.caseIds = ['unknown'];
  shouldReject(report);
  report = clone(original);
  report.mode = 'live-qvac-passage-agent';
  shouldReject(report);
  await assert.rejects(runRetrievalEvaluation({ ...options, selectors: [] }));
  await assert.rejects(runRetrievalEvaluation({ ...options, caseIds: ['unknown'] }));
});
