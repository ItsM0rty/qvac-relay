import { performance } from 'node:perf_hooks';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  RETRIEVAL_CASES,
  RETRIEVAL_FIXTURE_VERSION,
  RETRIEVAL_CASES_STABLE_ID,
  type RetrievalCase,
} from './retrieval-cases.js';
import { projectPassages, lexicalRetrieve, RETRIEVAL_CONFIG } from './retrieval.js';
import { buildContext, INSTRUCTIONS, type Selection } from './context.js';
import { MINILM } from './minilm.js';
import { createSelector, type SelectorMode } from './selectors.js';
import { parseRecord, stableId, type RelayRecord, type BriefRecord } from './records.js';
import { Agent, TOOLS } from './agent.js';
import { RelayStore } from './store.js';
import { QvacModel } from './qvac.js';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const RETRIEVAL_EVAL_CONFIG = {
  version: 7,
  fixtureVersion: RETRIEVAL_FIXTURE_VERSION,
  datasetHash: RETRIEVAL_CASES_STABLE_ID,
  retrieval: RETRIEVAL_CONFIG,
  minilm: MINILM,
  laya: 'passage-three-class-v2',
  generator: 'QVAC0.22.0 Qwen3 1.7B Q4 CPU',
  contextBudget: 7000,
  agentMaxCalls: 12,
  repairs: 2,
  timeoutMs: 600_000,
  harnessHash: stableId(INSTRUCTIONS, JSON.stringify(TOOLS)),
};
export function fixtureRecords(entry: RetrievalCase, owner = 'a'.repeat(64)): RelayRecord[] {
  const base = { schemaVersion: 1, owner, caseId: entry.id, createdAt: '2026-11-01T00:00:00Z' };
  return [
    parseRecord({
      ...base,
      kind: 'case',
      id: `${entry.id}-case`,
      title: entry.family,
      task: entry.task,
    }),
    ...entry.evidence.map((e) => parseRecord({ ...base, ...e, kind: 'evidence' })),
  ];
}
function coverage(entry: RetrievalCase, passages: Array<{ sourceId: string; text: string }>) {
  const covered = entry.expectedSpans.filter((span) =>
    passages.some((p) => p.sourceId === span.sourceId && p.text.includes(span.quote)),
  );
  return {
    recall: entry.expectedSpans.length ? covered.length / entry.expectedSpans.length : null,
    covered: covered.map((s) => s.sourceId),
    omitted: entry.expectedSpans.filter((s) => !covered.includes(s)).map((s) => s.sourceId),
    distractors: passages.filter(
      (p) =>
        !entry.expectedSpans.some((s) => p.sourceId === s.sourceId && p.text.includes(s.quote)),
    ).length,
    noRelevantOptional: entry.expectedSpans.length === 0,
  };
}
export function rankingOrigin(
  selector: string,
  selection: { fallback?: string; usage?: unknown },
): string {
  if (selection.fallback) return 'lexical-fallback';
  if (selector === 'deterministic') return 'lexical';
  const usage = selection.usage as
    { cacheHit?: boolean; decisionCalls?: number; batchMs?: unknown[] } | undefined;
  if (usage?.cacheHit) return 'cached-ranking';
  if ((usage?.decisionCalls ?? 0) > 0 || (usage?.batchMs?.length ?? 0) > 0) return 'native-ranking';
  return 'empty-candidates';
}
export interface RetrievalEvaluationOptions {
  mode: 'retrieval' | 'agent';
  trials: number;
  selectors: SelectorMode[];
  split: 'all' | 'development' | 'heldout';
  caseIds?: string[];
}
export interface RetrievalEvalRow {
  caseId: string;
  selector: SelectorMode;
  trial: number;
  [key: string]: unknown;
}
export interface RetrievalEvalReport {
  mode: string;
  configuration: typeof RETRIEVAL_EVAL_CONFIG;
  configurationHash: string;
  options: RetrievalEvaluationOptions;
  cases: string[];
  sourceCommit: string;
  rows: RetrievalEvalRow[];
  limitations: string[];
}
export function validateRetrievalReport(
  report: RetrievalEvalReport,
  options: { historicalConfiguration?: boolean } = {},
): RetrievalEvalReport {
  if (
    !['retrieval', 'agent'].includes(report.options.mode) ||
    report.mode !==
      (report.options.mode === 'agent'
        ? 'live-qvac-passage-agent'
        : 'passage-retrieval-with-local-rankers')
  )
    throw new Error('Retrieval mode must match its inference label');
  if (!options.historicalConfiguration && report.configurationHash !== sha(RETRIEVAL_EVAL_CONFIG))
    throw new Error('Incompatible canonical retrieval configuration');
  if (
    options.historicalConfiguration &&
    sha(report.configuration.retrieval) !== sha(RETRIEVAL_EVAL_CONFIG.retrieval)
  )
    throw new Error('Historical passage segmentation is incompatible with current regrading');
  if (
    !Number.isInteger(report.options.trials) ||
    report.options.trials < 1 ||
    report.options.trials > 3 ||
    !report.cases.length ||
    !report.options.selectors.length ||
    report.options.selectors.some((s) => !['deterministic', 'minilm', 'laya'].includes(s)) ||
    !['all', 'development', 'heldout'].includes(report.options.split)
  )
    throw new Error('Invalid retrieval run options');
  const registered = RETRIEVAL_CASES.filter(
    (e) =>
      (report.options.split === 'all' || e.split === report.options.split) &&
      (!report.options.caseIds || report.options.caseIds.includes(e.id)),
  ).map((e) => e.id);
  if (
    report.cases.some((id) => !registered.includes(id)) ||
    registered.some((id) => !report.cases.includes(id))
  )
    throw new Error('Mismatched retrieval fixture identities');
  if (
    report.configurationHash !== sha(report.configuration) ||
    report.configuration.datasetHash !== RETRIEVAL_CASES_STABLE_ID
  )
    throw new Error('Incompatible retrieval configuration or fixture identity');
  if (
    new Set(report.cases).size !== report.cases.length ||
    new Set(report.options.selectors).size !== report.options.selectors.length
  )
    throw new Error('Duplicate configured identities');
  const expected = new Set(
    report.cases.flatMap((id) =>
      report.options.selectors.flatMap((selector) =>
        Array.from({ length: report.options.trials }, (_, i) => `${id}/${selector}/${i + 1}`),
      ),
    ),
  );
  const seen = new Set<string>();
  for (const row of report.rows) {
    const key = `${row.caseId}/${row.selector}/${row.trial}`;
    if (!expected.has(key) || seen.has(key))
      throw new Error(`Unexpected or duplicate retrieval identity ${key}`);
    seen.add(key);
  }
  for (const key of expected) if (!seen.has(key)) throw new Error(`Missing retrieval case ${key}`);
  return report;
}
export async function runRetrievalEvaluation(
  options: RetrievalEvaluationOptions,
): Promise<RetrievalEvalReport> {
  if (!Number.isInteger(options.trials) || options.trials < 1 || options.trials > 3)
    throw new Error('Retrieval trials must be1..3');
  if (
    !options.selectors.length ||
    options.selectors.some((s) => !['deterministic', 'minilm', 'laya'].includes(s))
  )
    throw new Error('Unknown selector');
  const entries = RETRIEVAL_CASES.filter(
    (e) =>
      (options.split === 'all' || e.split === options.split) &&
      (!options.caseIds || options.caseIds.includes(e.id)),
  );
  if (!entries.length || options.caseIds?.some((id) => !entries.some((e) => e.id === id)))
    throw new Error('Unknown or empty case selection');
  const rows: RetrievalEvalRow[] = [];
  for (const selectorMode of options.selectors) {
    const selector = createSelector(selectorMode);
    let model: QvacModel | undefined;
    try {
      if (options.mode === 'agent') model = new QvacModel('1.7b');
      for (let trial = 1; trial <= options.trials; trial++)
        for (const entry of entries) {
          const started = performance.now(),
            rssBefore = process.memoryUsage().rss;
          let peak = rssBefore;
          const sampler = setInterval(() => {
            peak = Math.max(peak, process.memoryUsage().rss);
          }, 25);
          sampler.unref();
          let directory: string | undefined, store: RelayStore | undefined;
          const row: RetrievalEvalRow = {
            caseId: entry.id,
            selector: selectorMode,
            trial,
            split: entry.split,
            family: entry.family,
          };
          try {
            const records = fixtureRecords(entry);
            const passages = projectPassages(records);
            const lexical = lexicalRetrieve(entry.task, passages, 12);
            row.corpus = {
              records: entry.evidence.length,
              characters: entry.evidence.reduce((n, e) => n + e.text.length, 0),
              passages: passages.length,
            };
            row.lexical = coverage(
              entry,
              lexical.map((p) => p.passage),
            );
            if (!model) {
              const context = await buildContext({
                task: entry.task,
                records,
                history: [],
                readIds: [],
                tools: TOOLS,
                selector,
                signal: AbortSignal.timeout(180_000),
                budget: 7000,
              });
              const selected = passages.filter((p) => context.selection.ids.includes(p.id));
              row.selection = context.selection;
              row.selected = coverage(entry, selected);
              row.estimatedInputTokens = context.estimatedTokens;
              row.fallback = context.selection.fallback ?? null;
              row.rankingOrigin = rankingOrigin(selectorMode, context.selection);
              row.nativeRanking = row.rankingOrigin === 'native-ranking';
              row.coldMs = performance.now() - started;
              const warmStart = performance.now();
              const warm = await buildContext({
                task: entry.task,
                records,
                history: [],
                readIds: [],
                tools: TOOLS,
                selector,
                signal: AbortSignal.timeout(180_000),
                budget: 7000,
              });
              row.warmMs = performance.now() - warmStart;
              row.warmUsage = warm.selection.usage ?? null;
              row.executionSucceeded = true;
              const quality = row.selected as { recall: number | null; distractors: number };
              row.success =
                !context.selection.fallback &&
                (quality.recall === null ? quality.distractors === 0 : quality.recall === 1);
            } else {
              directory = await mkdtemp(join(tmpdir(), 'relay-passage-eval-'));
              store = await RelayStore.open(directory);
              const ownRecords = fixtureRecords(entry, store.owner);
              for (const record of ownRecords) await store.put(record);
              const cp = await new Agent(store, model).run(entry.id, {
                selector,
                maxCalls: 12,
                maxRepairs: 2,
                timeoutMs: 600_000,
                contextBudget: 7000,
              });
              const all = await store.list(entry.id);
              const brief = all.find(
                (r): r is BriefRecord => r.kind === 'brief' && r.id === cp.briefId,
              );
              const lines = (await readFile(join(directory, 'traces', `${cp.runId}.jsonl`), 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, unknown>);
              const contexts = lines.filter((e) => e.event === 'context'),
                turns = lines.filter((e) => e.event === 'model'),
                tools = lines.filter((e) => e.event === 'tool');
              row.status = cp.status;
              row.failure = cp.reason ?? null;
              row.calls = cp.calls;
              row.repairs = cp.repairs;
              const actualQuotes =
                brief?.facts.flatMap((f) =>
                  f.sources.map((s) => ({ sourceId: s.id, text: s.quote })),
                ) ?? [];
              row.outcome = coverage(entry, actualQuotes);
              row.fallback = contexts
                .filter((e) => e.fallback !== undefined)
                .map((e) => e.fallback);
              row.success =
                entry.expectedSpans.length > 0 &&
                cp.status === 'completed' &&
                brief?.factPolicy === 'quoted-observations-v1' &&
                (row.outcome as { recall: number | null }).recall === 1;
              row.recoveryCalls = tools.filter((e) => e.name === 'find_evidence').length;
              row.readCalls = tools.filter((e) => e.name === 'read_record').length;
              row.generatorUsage = turns.map((e) => e.stats);
              row.contexts = contexts.map(
                ({ ids, recordIds, locations, policy, usage, fallback, estimatedInputTokens }) => ({
                  ids,
                  recordIds,
                  locations,
                  policy,
                  usage,
                  fallback,
                  estimatedInputTokens,
                }),
              );
              row.storedOutcome = {
                case: ownRecords[0],
                evidence: ownRecords.slice(1),
                brief,
                checkpoint: cp,
              };
            }
          } catch (error) {
            row.success = false;
            row.failure =
              error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          } finally {
            clearInterval(sampler);
            row.totalMs = performance.now() - started;
            row.memory = {
              scope:
                'Node process RSS sampled every25ms; includes in-process ONNX when used, excludes QVAC child and global peak',
              before: rssBefore,
              sampledPeak: Math.max(peak, process.memoryUsage().rss),
              after: process.memoryUsage().rss,
            };
            await store?.close();
            if (directory) await rm(directory, { recursive: true, force: true });
          }
          rows.push(row);
          console.error(
            JSON.stringify({
              event: 'passage-evaluation',
              mode: options.mode,
              caseId: entry.id,
              selector: selectorMode,
              trial,
              success: row.success,
              ms: row.totalMs,
              failure: row.failure ?? null,
            }),
          );
        }
    } finally {
      try {
        await selector.close?.();
      } finally {
        await model?.close();
      }
    }
  }
  let sourceCommit = process.env.RELAY_VERIFIED_COMMIT ?? 'unavailable';
  try {
    if (sourceCommit === 'unavailable')
      sourceCommit = execFileSync(
        'git',
        ['-c', `safe.directory=${process.cwd()}`, 'rev-parse', 'HEAD'],
        { encoding: 'utf8' },
      ).trim();
  } catch {}
  return validateRetrievalReport({
    mode:
      options.mode === 'agent' ? 'live-qvac-passage-agent' : 'passage-retrieval-with-local-rankers',
    configuration: RETRIEVAL_EVAL_CONFIG,
    configurationHash: sha(RETRIEVAL_EVAL_CONFIG),
    sourceCommit,
    options,
    cases: entries.map((e) => e.id),
    rows,
    limitations: [
      'Frozen synthetic families are development/heldout disjoint; no fine-tuning. These are quotation/span checks, not semantic truth scores.',
      'MiniLM scores raw relevance logits, not calibrated probabilities. It cannot recover a passage omitted by lexical retrieval.',
      'Rankers order optional evidence. Mandatory context is protected separately. No-relevant cases can still admit distracting optional text.',
      'Cold includes model loading after unload. Warm includes a second context build; MiniLM may report a result-cache hit. Do not confuse it with warm native scoring.',
      'Generation uses estimated input accounting, not the reranker tokenizer. Latency includes ranking and fixture work; model caches and OS cache are uncontrolled.',
    ],
  });
}
