import { createHash } from 'node:crypto';
import { buildContext } from './context.js';
import { TOOLS } from './agent.js';
import { MINILM } from './minilm.js';
import {
  RETRIEVAL_CASES,
  RETRIEVAL_CASES_STABLE_ID,
  RETRIEVAL_FIXTURE_VERSION,
} from './retrieval-cases.js';
import { lexicalRetrieve, projectPassages } from './retrieval.js';
import {
  fixtureRecords,
  validateRetrievalReport,
  type RetrievalEvalReport,
} from './retrieval-eval.js';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SCORE_SOURCE = '57fc4d68cdc53dba9bd9c7eec83c0b983c9fe4f4';
type Usage = {
  scores?: Array<{ id: string; score: number }>;
  model?: unknown;
  cacheHit?: boolean;
  candidateIds?: string[];
  classes?: Record<string, string>;
};

/** Reapply recorded rankings to the current bounded context, without loading a model. */
export async function replayRecordedRankings(
  input: RetrievalEvalReport,
  currentSourceCommit: string,
) {
  validateRetrievalReport(input, { historicalConfiguration: true });
  if (input.options.mode !== 'retrieval' || !currentSourceCommit.trim())
    throw new Error('Retrieval-only input and current source identity required');
  if (
    input.configuration.fixtureVersion !== RETRIEVAL_FIXTURE_VERSION ||
    input.configuration.datasetHash !== RETRIEVAL_CASES_STABLE_ID ||
    sha(input.configuration.minilm) !== sha(MINILM)
  )
    throw new Error('Frozen fixture or MiniLM configuration mismatch');
  if (input.sourceCommit !== 'unavailable' && input.sourceCommit !== SCORE_SOURCE)
    throw new Error('Unexpected score source commit');
  const saved = new Map<string, { ids: string[]; scores: Array<{ id: string; score: number }> }>();
  const rows = [];
  // Native trial must be processed before cache hits, regardless of report row ordering.
  for (const row of [...input.rows].sort((a, b) => a.trial - b.trial)) {
    const entry = RETRIEVAL_CASES.find((e) => e.id === row.caseId)!;
    const records = fixtureRecords(entry),
      passages = projectPassages(records);
    const pool = lexicalRetrieve(entry.task, passages, 12).map((p) => p.passage.id);
    const selection = row.selection as
      { ids?: unknown; fallback?: string; usage?: Usage } | undefined;
    if (!selection || !Array.isArray(selection.ids) || selection.fallback)
      throw new Error(`Missing or fallback ranking: ${row.caseId}/${row.selector}`);
    const usage = selection.usage;
    let ordered = pool,
      rankingSource = 'lexical-recomputed';
    if (row.selector === 'minilm' && pool.length) {
      let scores: Array<{ id: string; score: number }>;
      if (usage?.cacheHit === true) {
        const previous = saved.get(row.caseId);
        if (!previous || !same(previous.ids, pool) || !same(usage.model, MINILM))
          throw new Error(`MiniLM cache has no matching native score record: ${row.caseId}`);
        scores = previous.scores;
        rankingSource = 'recorded-native-scores-reused-for-cache';
      } else {
        if (
          !same(usage?.model, MINILM) ||
          usage?.cacheHit !== false ||
          !Array.isArray(usage.scores)
        )
          throw new Error(`Missing MiniLM scores or model: ${row.caseId}`);
        scores = usage.scores;
        if (
          !same(
            scores.map((s) => s.id),
            pool,
          ) ||
          scores.some((s) => !Number.isFinite(s.score))
        )
          throw new Error(`Malformed MiniLM scores or candidate pool: ${row.caseId}`);
        saved.set(row.caseId, { ids: [...pool], scores: structuredClone(scores) });
        rankingSource = 'recorded-native-scores';
      }
      ordered = scores
        .map((s, i) => ({ ...s, i }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((s) => s.id);
    } else if (row.selector === 'laya' && pool.length) {
      const classes = usage?.classes,
        weights: Record<string, number> = { directly_relevant: 2, background: 1, unrelated: 0 };
      const layaPool = lexicalRetrieve(
        entry.task,
        pool.map((id) => passages.find((p) => p.id === id)!),
        12,
      ).map((p) => p.passage.id);
      if (
        !same(usage?.candidateIds, layaPool) ||
        !classes ||
        !same(Object.keys(classes).sort(), [...pool].sort()) ||
        pool.some((id) => !Object.hasOwn(weights, classes[id]!))
      )
        throw new Error(`Malformed Laya classes or candidate pool: ${row.caseId}`);
      ordered = layaPool
        .map((id, i) => ({ id, i }))
        .sort((a, b) => weights[classes[b.id]!]! - weights[classes[a.id]!]! || a.i - b.i)
        .map((x) => x.id);
      rankingSource = 'recorded-native-classes';
    } else if (!pool.length) {
      if (selection.ids.length !== 0)
        throw new Error(`Nonempty selection for empty candidate pool: ${row.caseId}`);
      rankingSource = 'empty-candidates';
    }
    const context = await buildContext({
      task: entry.task,
      records,
      history: [],
      tools: TOOLS,
      selector: {
        select: async (query, candidates) => {
          if (
            query !== entry.task ||
            !same(
              candidates.map((c) => c.id),
              pool,
            )
          )
            throw new Error('Replay query or candidate pool mismatch');
          return { ids: ordered, policy: 'recorded-ranking-replay' };
        },
      },
      signal: new AbortController().signal,
      budget: 7000,
    });
    if (context.selection.fallback)
      throw new Error(`Replay selector fallback: ${context.selection.fallback}`);
    const chosen = passages.filter((p) => context.selection.ids.includes(p.id));
    const covered = entry.expectedSpans.filter((s) =>
      chosen.some((p) => p.sourceId === s.sourceId && p.text.includes(s.quote)),
    );
    const distractors = chosen.filter(
      (p) =>
        !entry.expectedSpans.some((s) => p.sourceId === s.sourceId && p.text.includes(s.quote)),
    ).length;
    const recall = entry.expectedSpans.length ? covered.length / entry.expectedSpans.length : null;
    rows.push({
      caseId: row.caseId,
      selector: row.selector,
      trial: row.trial,
      rankingSource,
      replaySucceeded: true,
      selection: context.selection,
      selected: {
        recall,
        covered: covered.map((s) => s.sourceId),
        omitted: entry.expectedSpans.filter((s) => !covered.includes(s)).map((s) => s.sourceId),
        distractors,
        noRelevantOptional: !entry.expectedSpans.length,
      },
      coveragePass: recall === null ? distractors === 0 : recall === 1,
    });
  }
  return {
    mode: 'recorded-ranking-budget-replay',
    nativeInference: false,
    scoreSourceCommit: SCORE_SOURCE,
    rawReportSourceCommit: input.sourceCommit,
    scoreSourceBasis: 'Clean archive manifest; raw report lacked Git metadata.',
    currentSourceCommit,
    currentContextBudget: 7000,
    fixtureVersion: RETRIEVAL_FIXTURE_VERSION,
    datasetHash: RETRIEVAL_CASES_STABLE_ID,
    queryIdentityBasis:
      'Derived from frozen fixture and historical harness; original report did not capture query text.',
    rows,
  };
}
