import {
  fixtureRecords,
  rankingOrigin,
  validateRetrievalReport,
  type RetrievalEvalReport,
} from './retrieval-eval.js';
import { RETRIEVAL_CASES } from './retrieval-cases.js';
import { projectPassages } from './retrieval.js';
/** Correct reporting from captured selections without rerunning a ranker or generator. */
export function regradePassageReport(
  input: RetrievalEvalReport,
): RetrievalEvalReport & { regrade: { mode: string; nativeInference: false; policy: string } } {
  const report = structuredClone(validateRetrievalReport(input, { historicalConfiguration: true }));
  for (const row of report.rows) {
    if (report.options.mode !== 'retrieval')
      throw new Error('Passage selection regrade requires retrieval-only report');
    const entry = RETRIEVAL_CASES.find((e) => e.id === row.caseId)!;
    const selection = row.selection as
      { ids?: unknown; fallback?: string; policy?: string } | undefined;
    if (
      !selection ||
      !Array.isArray(selection.ids) ||
      new Set(selection.ids).size !== selection.ids.length
    )
      throw new Error(`Missing or duplicate recorded passage selection: ${row.caseId}`);
    const passages = projectPassages(fixtureRecords(entry));
    if (selection.ids.some((id) => !passages.some((p) => p.id === id)))
      throw new Error(`Unknown recorded passage: ${row.caseId}`);
    const ids = selection.ids as string[];
    const selected = passages.filter((p) => ids.includes(p.id));
    const relevant = entry.expectedSpans.filter((s) =>
      selected.some((p) => p.sourceId === s.sourceId && p.text.includes(s.quote)),
    );
    const distractors = selected.filter(
      (p) =>
        !entry.expectedSpans.some((s) => p.sourceId === s.sourceId && p.text.includes(s.quote)),
    ).length;
    const recall = entry.expectedSpans.length ? relevant.length / entry.expectedSpans.length : null;
    row.selected = {
      recall,
      covered: relevant.map((s) => s.sourceId),
      omitted: entry.expectedSpans.filter((s) => !relevant.includes(s)).map((s) => s.sourceId),
      distractors,
      noRelevantOptional: !entry.expectedSpans.length,
    };
    if (!entry.expectedSpans.length && row.lexical && typeof row.lexical === 'object')
      row.lexical = { ...row.lexical, recall: null };
    row.fallback = selection.fallback ?? null;
    row.rankingOrigin = rankingOrigin(row.selector, selection);
    row.nativeRanking = row.rankingOrigin === 'native-ranking';
    row.executionSucceeded = true;
    const usage = selection as { usage?: { cacheHit?: boolean } };
    row.timing = {
      initialContextMs: row.coldMs ?? null,
      initialOrigin: row.rankingOrigin,
      repeatContextMs: row.warmMs ?? null,
      repeatCacheHit: Boolean((row.warmUsage as { cacheHit?: boolean } | undefined)?.cacheHit),
      scope:
        'First and repeated context builds include ranking/cleanup. Repeated Laya builds reload weights; MiniLM may use result cache. Native warm-batch timing is a separate probe.',
    };
    if (usage.usage?.cacheHit) row.coldMs = null;
    row.success = !selection.fallback && (recall === null ? distractors === 0 : recall === 1);
  }
  return {
    ...report,
    regrade: {
      mode: 'recorded-passage-selection-regrade',
      nativeInference: false,
      policy: 'span-recall-v2-null-abstention-visible-fallback',
    },
  };
}
