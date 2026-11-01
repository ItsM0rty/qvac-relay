import assert from 'node:assert/strict';
import test from 'node:test';
import { runEvaluation } from '../src/eval.js';
import { regradeReport } from '../src/regrade.js';

test('regrades captured replay state without modifying it or trusting recorded checks', async () => {
  const report = await runEvaluation({ mode: 'replay', selector: 'deterministic', trials: 1 });
  const before = structuredClone(report);
  const regraded = regradeReport(report);
  assert.deepEqual(report, before);
  assert.equal(regraded.mode, 'recorded-state-regrade');
  assert.equal(regraded.nativeInference, false);
  assert.equal(regraded.sourceMode, 'replay');
  assert.equal(regraded.results.length, 3);
  assert.ok(regraded.results.every((result) => result.success));
  const tampered = structuredClone(report);
  const first = tampered.results[0]!;
  const source = first.storedOutcome!.evidence.find(
    (record) => record.id === `${first.caseId}-source`,
  )!;
  source.text = 'Different evidence without the original quotation.';
  const changed = regradeReport(tampered).results[0]!;
  assert.equal(first.success, true);
  assert.equal(changed.success, false);
  assert.equal(changed.checks.citationsValid, false);

  const missing = structuredClone(report);
  delete missing.results[0]!.storedOutcome;
  assert.throws(() => regradeReport(missing), /deployment trial 1: missing storedOutcome/);
  const mismatched = structuredClone(report);
  mismatched.results[0]!.storedOutcome!.case.caseId = 'wrong-case';
  assert.throws(() => regradeReport(mismatched), /deployment trial 1: mismatched fixture/);
  const wrongSuite = structuredClone(report);
  wrongSuite.datasetHash = 'different';
  assert.throws(() => regradeReport(wrongSuite), /suite and dataset/);
  const duplicate = structuredClone(report);
  const state = duplicate.results[0]!.storedOutcome!;
  state.evidence.push(structuredClone(state.evidence[0]!));
  assert.throws(() => regradeReport(duplicate), /deployment trial 1: duplicate record IDs/);
  const requestLinkage = structuredClone(report);
  requestLinkage.results[2]!.storedOutcome!.checkpoint.requestIds = ['missing-request'];
  assert.throws(() => regradeReport(requestLinkage), /checkpoint request linkage/);
  const owner = structuredClone(report);
  owner.results[0]!.storedOutcome!.checkpoint.owner = 'b'.repeat(64);
  assert.throws(() => regradeReport(owner), /checkpoint ownership/);
  const absentLink = structuredClone(report);
  delete absentLink.results[0]!.storedOutcome!.checkpoint.briefId;
  assert.throws(() => regradeReport(absentLink), /checkpoint brief linkage/);
  const linkage = structuredClone(report);
  linkage.results[0]!.storedOutcome!.checkpoint.briefId = 'missing-brief';
  assert.throws(() => regradeReport(linkage), /checkpoint brief linkage/);
});
