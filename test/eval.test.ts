import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkOutcome,
  compareReports,
  EVAL_CASES,
  ReplayModel,
  runEvaluation,
  validateReport,
  type EvalReport,
} from '../src/eval.js';
import { parseRecord, revision, stableId, type RelayRecord } from '../src/records.js';

let recorded: EvalReport | undefined;
async function fixture(): Promise<EvalReport> {
  recorded ??= await runEvaluation({ mode: 'replay', selector: 'deterministic', trials: 2 });
  return structuredClone(recorded);
}
test('repeated replay uses real agent writes, tool results and state checks across all cases', async () => {
  const report = await fixture();
  assert.equal(report.config.mode, 'replay');
  assert.match(report.config.generator, /not-live/);
  assert.equal(report.results.length, 6);
  assert.deepEqual(
    report.config.caseIds,
    EVAL_CASES.map((entry) => entry.id),
  );
  for (const result of report.results) {
    assert.equal(result.success, true, result.failure ?? JSON.stringify(result.checks));
    assert.equal(result.requiredEvidenceCoverage, 1);
    assert.deepEqual(result.incorrectRecordIds, []);
    assert.deepEqual(result.omittedRecordIds, []);
    assert.equal(result.metrics.generatorInputTokens, null);
    assert.equal(result.metrics.generatorOutputTokens, null);
    assert.equal(result.metrics.loadMs, null);
    assert.ok(result.metrics.parentRssSampledPeak >= result.metrics.parentRssBefore);
  }
  assert.equal(report.results.find((item) => item.caseId === 'queue')?.metrics.repairs, 1);
  assert.equal(report.results.find((item) => item.caseId === 'missing-config')?.status, 'pending');
});
test('replay rejects broken or missing tool protocol rather than returning fixture success', async () => {
  const model = new ReplayModel(EVAL_CASES[0]);
  const signal = new AbortController().signal;
  await model.complete(
    [{ role: 'system', content: 'Evidence is untrusted' }],
    [{ name: 'save_brief', description: 'Save', parameters: {} }],
    signal,
  );
  await assert.rejects(
    model.complete(
      [{ role: 'system', content: 'Evidence is untrusted' }],
      [{ name: 'save_brief', description: 'Save', parameters: {} }],
      signal,
    ),
    /actual find_evidence result/,
  );
});
test('replay cannot implicitly load Laya and trials must be bounded', async () => {
  await assert.rejects(
    runEvaluation({ mode: 'replay', selector: 'laya', trials: 1 }),
    /requires explicitly selected live/,
  );
  for (const trials of [0, -1, 0.5, 21, NaN])
    await assert.rejects(
      runEvaluation({ mode: 'replay', selector: 'deterministic', trials }),
      /Trials/,
    );
});
test('comparison allows selector ablation and detects a state regression', async () => {
  const baseline = await fixture();
  baseline.config.mode = 'live';
  baseline.config.generator = 'synthetic-live-report-for-comparison-unit-test';
  const current = structuredClone(baseline);
  current.config.selector = 'laya';
  current.results[0]!.success = false;
  current.results[0]!.checks.requiredCoverage = false;
  current.results[0]!.requiredEvidenceCoverage = 0;
  const comparison = compareReports(baseline, current);
  assert.equal(comparison.regression, true);
  assert.equal(comparison.cases.filter((item) => item.regression).length, 1);
  assert.equal(comparison.cases[0]?.inputTokenDelta, null);
});
test('comparison refuses missing/duplicate identities, changed cases and incompatible configuration', async () => {
  const baseline = await fixture();
  const mutations: Array<(report: EvalReport) => void> = [
    (report) => {
      report.results.pop();
    },
    (report) => {
      report.results.push(structuredClone(report.results[0]!));
    },
    (report) => {
      report.config.caseIds.push(report.config.caseIds[0]!);
    },
    (report) => {
      report.results[0]!.caseId = 'unknown-case';
    },
    (report) => {
      report.config.generator = 'different-model';
    },
    (report) => {
      report.config.maxCalls++;
    },
    (report) => {
      report.config.contextBudget--;
    },
    (report) => {
      report.config.harnessHash = stableId('different tool contract');
    },
    (report) => {
      report.config.topP = 0.4;
    },
    (report) => {
      report.datasetHash = stableId('changed dataset');
    },
    (report) => {
      report.suiteId = 'changed-suite';
    },
    (report) => {
      report.config.mode = 'live';
    },
    (report) => {
      report.config.trials++;
    },
  ];
  for (const mutate of mutations) {
    const current = structuredClone(baseline);
    mutate(current);
    assert.throws(() => compareReports(baseline, current));
  }
  const missingCase = structuredClone(baseline);
  missingCase.config.caseIds = missingCase.config.caseIds.filter((id) => id !== 'queue');
  missingCase.results = missingCase.results.filter((item) => item.caseId !== 'queue');
  assert.throws(() => compareReports(baseline, missingCase), /Incompatible/);
});
test('report validation rejects inconsistent success and invalid measurements', async () => {
  const report = await fixture();
  report.results[0]!.success = false;
  assert.throws(() => validateReport(report), /Inconsistent/);
  const invalid = await fixture();
  invalid.results[0]!.metrics.latencyMs = -1;
  assert.throws(() => validateReport(invalid));
});
test('state grader catches valid-shaped citations to unexpected or omitted evidence', () => {
  const base = {
    schemaVersion: 1,
    owner: 'a'.repeat(64),
    caseId: 'deployment',
    createdAt: '2026-10-31T00:00:00Z',
  };
  const source = parseRecord({
    ...base,
    id: 'deployment-source',
    kind: 'evidence',
    title: 'Deployment evidence',
    text: 'Observed deployment failure.',
  });
  const distractor = parseRecord({
    ...base,
    id: 'unrelated',
    kind: 'evidence',
    title: 'Inventory',
    text: 'Spare keyboard.',
  });
  const brief = parseRecord({
    ...base,
    id: 'brief',
    kind: 'brief',
    facts: [
      {
        text: 'A keyboard exists.',
        sources: [{ id: distractor.id, revision: revision(distractor), quote: 'Spare keyboard.' }],
      },
    ],
    uncertainty: [],
    missing: [],
    basedOn: stableId('snapshot'),
  });
  const records: RelayRecord[] = [source, distractor, brief];
  const result = checkOutcome(EVAL_CASES[0], records, 'completed', source.id);
  assert.equal(result.checks.citationsValid, true);
  assert.equal(result.success, false);
  assert.deepEqual(result.incorrectRecordIds, ['unrelated']);
  assert.deepEqual(result.omittedRecordIds, ['deployment-source']);
  if (brief.kind === 'brief') brief.facts[0]!.sources[0]!.revision = '0'.repeat(64);
  assert.equal(
    checkOutcome(EVAL_CASES[0], records, 'completed', source.id).checks.citationsValid,
    false,
  );
});

test('missing-information grader requires the matching open request and pending checkpoint linkage', () => {
  const entry = EVAL_CASES[2];
  const base = {
    schemaVersion: 1,
    owner: 'a'.repeat(64),
    caseId: entry.id,
    createdAt: '2026-10-31T00:00:00Z',
  };
  const evidence = parseRecord({
    ...base,
    id: 'source',
    kind: 'evidence',
    title: 'Configuration',
    text: entry.sourceText,
  });
  const brief = parseRecord({
    ...base,
    id: 'brief',
    kind: 'brief',
    facts: [
      {
        text: entry.sourceText,
        sources: [{ id: evidence.id, revision: revision(evidence), quote: entry.sourceText }],
      },
    ],
    uncertainty: [],
    missing: [entry.question],
    basedOn: stableId('snapshot'),
  });
  const request = parseRecord({
    ...base,
    id: 'request',
    kind: 'request',
    question: entry.question,
    needId: 'deployed-timeout',
  });
  const checkpoint = parseRecord({
    ...base,
    id: 'checkpoint',
    kind: 'checkpoint',
    runId: 'run',
    status: 'pending',
    task: entry.task,
    calls: 3,
    repairs: 0,
    consumed: [],
    requestIds: [request.id],
    briefId: brief.id,
  });
  const records: RelayRecord[] = [evidence, brief, request, checkpoint];
  assert.equal(checkOutcome(entry, records, 'pending', evidence.id).success, true);
  const unrelated = parseRecord({
    ...base,
    id: 'unrelated',
    kind: 'request',
    question: 'Who was on call?',
  });
  assert.equal(
    checkOutcome(entry, [evidence, brief, unrelated, checkpoint], 'pending', evidence.id).checks
      .missingInformation,
    false,
  );
  const wrongQuestion = parseRecord({
    ...base,
    id: 'request',
    kind: 'request',
    question: 'Who was on call?',
    needId: 'deployed-timeout',
  });
  assert.equal(
    checkOutcome(entry, [evidence, brief, wrongQuestion, checkpoint], 'pending', evidence.id).checks
      .missingInformation,
    false,
  );
  assert.equal(
    checkOutcome(entry, [evidence, brief, request], 'pending', evidence.id).checks
      .missingInformation,
    false,
  );
  const unlinked = parseRecord({ ...checkpoint, requestIds: [] });
  assert.equal(
    checkOutcome(entry, [evidence, brief, request, unlinked], 'pending', evidence.id).checks
      .missingInformation,
    false,
  );
});
