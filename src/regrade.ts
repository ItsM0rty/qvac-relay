import {
  checkOutcome,
  EVAL_CASES,
  EVAL_DATASET_HASH,
  EVAL_SUITE_ID,
  validateReport,
} from './eval.js';
import type { RelayRecord } from './records.js';

/** Re-evaluate captured records without model inference or store access. */
export function regradeReport(input: unknown) {
  const report = validateReport(input);
  if (report.suiteId !== EVAL_SUITE_ID || report.datasetHash !== EVAL_DATASET_HASH)
    throw new Error('Recorded report does not match the current evaluation suite and dataset');
  const results = report.results.map((item) => {
    const label = `${item.caseId} trial ${item.trial}`;
    const entry = EVAL_CASES.find((candidate) => candidate.id === item.caseId);
    if (!entry) throw new Error(`${label}: unknown fixture case`);
    const state = item.storedOutcome;
    if (!state) throw new Error(`${label}: missing storedOutcome`);
    const records: RelayRecord[] = [
      state.case,
      ...state.evidence,
      ...state.requests,
      ...state.briefs,
      state.checkpoint,
    ];
    if (
      records.some((record) => record.caseId !== entry.id) ||
      state.case.id !== `${entry.id}-case` ||
      state.case.title !== entry.title ||
      state.case.task !== entry.task
    )
      throw new Error(`${label}: mismatched fixture case identity`);
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new Error(`${label}: duplicate record IDs`);
    const checkpoint = state.checkpoint;
    if (checkpoint.owner !== state.case.owner || checkpoint.status !== item.status)
      throw new Error(`${label}: checkpoint ownership or status mismatch`);
    if (
      (state.briefs.length > 0 && !checkpoint.briefId) ||
      (checkpoint.briefId &&
        !state.briefs.some(
          (brief) => brief.id === checkpoint.briefId && brief.owner === checkpoint.owner,
        ))
    )
      throw new Error(`${label}: checkpoint brief linkage mismatch`);
    if (
      checkpoint.requestIds.some(
        (id) =>
          !state.requests.some(
            (request) => request.id === id && request.owner === checkpoint.owner,
          ),
      )
    )
      throw new Error(`${label}: checkpoint request linkage mismatch`);
    return {
      caseId: item.caseId,
      trial: item.trial,
      status: checkpoint.status,
      ...checkOutcome(entry, records, checkpoint.status, `${entry.id}-source`),
    };
  });
  return {
    mode: 'recorded-state-regrade' as const,
    nativeInference: false as const,
    sourceMode: report.config.mode,
    suiteId: report.suiteId,
    datasetHash: report.datasetHash,
    results,
  };
}
