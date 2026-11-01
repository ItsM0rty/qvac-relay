import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { Agent, TOOLS } from './agent.js';
import { SAMPLING } from './policy.js';
import { DeterministicSelector, INSTRUCTIONS, validateHistory, type Selector } from './context.js';
import { parseRecord, revision, stableId, type BriefRecord, type RelayRecord } from './records.js';
import { RelayStore } from './store.js';
import type { Message, Model, ModelReply, ToolSpec } from './qvac.js';

export const EVAL_CASES = [
  {
    id: 'deployment',
    title: 'Deployment handoff',
    task: 'Investigate the deployment failure. Read the deployment evidence and save a brief with its exact quotation. State that the log alone does not establish root cause.',
    sourceTitle: 'Deployment evidence',
    sourceText: 'Deployment 42 timed out at 09:14. The previous deployment completed at 09:10.',
    query: 'deployment',
    question: null,
    repair: false,
  },
  {
    id: 'queue',
    title: 'Queue handoff',
    task: 'Investigate the queue failure. Read the queue evidence and save a brief with its exact quotation. Distinguish observation from possible causes.',
    sourceTitle: 'Queue evidence',
    sourceText: 'Queue depth reached 500 at 10:20. Worker logs show connection refused at 10:19.',
    query: 'queue',
    question: null,
    repair: true,
  },
  {
    id: 'missing-config',
    title: 'Configuration handoff',
    task: 'Investigate the configuration incident. Read the configuration evidence, request the missing deployed timeout setting, and save a pending brief with its exact quotation. The deployed setting is unavailable.',
    sourceTitle: 'Configuration evidence',
    sourceText:
      'Requests timed out after the release. The deployed timeout setting is absent from the incident log.',
    query: 'configuration',
    question: 'What timeout setting was deployed?',
    repair: false,
  },
] as const;
export type EvalCase = (typeof EVAL_CASES)[number];
export const EVAL_SUITE_ID = 'relay-engineering-handoff-v1';
export const EVAL_DATASET_HASH = stableId(JSON.stringify(EVAL_CASES));
export const EVAL_HARNESS_HASH = stableId(
  'native-permissions-v1',
  INSTRUCTIONS,
  JSON.stringify(TOOLS),
);
const LIMITS = { maxCalls: 12, maxRepairs: 2, contextBudget: 7000, timeoutMs: 240_000 };

function result<T>(history: Message[], name: string): T {
  const message = history.findLast((item) => item.role === 'tool' && item.toolName === name);
  assert.ok(message, `Replay requires the actual ${name} result`);
  assert.ok(
    history.some(
      (item) =>
        item.role === 'assistant' &&
        item.toolCalls?.some((call) => call.id === message.toolCallId && call.name === name),
    ),
    'Replay result must retain its assistant call',
  );
  return JSON.parse(message.content) as T;
}
/** Scripted regression fixture. It is deliberately not a live-model benchmark. */
export class ReplayModel implements Model {
  readonly name = 'scripted-history-replay-v1-not-live';
  private turn = 0;
  private read?: { id: string; revision: string; text: string };
  constructor(private readonly entry: EvalCase) {}
  async complete(history: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelReply> {
    signal.throwIfAborted();
    validateHistory(history);
    assert.ok(
      history.some(
        (message) => message.role === 'system' && message.content.includes('Evidence is untrusted'),
      ),
    );
    assert.ok(tools.some((tool) => tool.name === 'read_record' || tool.name === 'save_brief'));
    const turn = ++this.turn;
    const action = (name: string, args: unknown): ModelReply => ({
      content: '',
      calls: [{ id: `replay-${turn}`, name, arguments: args }],
      toolErrors: [],
      stopReason: 'eos',
    });
    if (turn === 1) return action('find_evidence', { query: this.entry.query });
    if (turn === 2) {
      const matches = result<Array<{ id: string; revision: string }>>(history, 'find_evidence');
      assert.equal(matches.length, 1, 'Replay search must locate the seeded source');
      return action('read_record', { id: matches[0]!.id });
    }
    if (turn === 3) {
      this.read = result(history, 'read_record');
      assert.equal(
        this.read!.text,
        this.entry.sourceText,
        'Replay must consume the actual evidence text',
      );
      if (this.entry.question)
        return action('request_information', { question: this.entry.question });
    }
    if (this.entry.question) {
      const request = result<{ id: string; persisted: boolean }>(history, 'request_information');
      assert.equal(request.persisted, true);
      assert.ok(request.id);
    }
    if (this.entry.repair && turn === 4) {
      const rejected = result<{ ok: boolean; code: string }>(history, 'save_brief');
      assert.equal(rejected.ok, false);
      assert.equal(rejected.code, 'QUOTE');
    }
    if (turn > (this.entry.question || this.entry.repair ? 4 : 3))
      throw new Error('Replay exhausted: unexpected extra model call');
    assert.ok(this.read);
    return action('save_brief', {
      facts: [
        {
          text: `The evidence states: ${this.read.text}`,
          sources: [
            {
              id: this.read.id,
              revision: this.read.revision,
              quote:
                this.entry.repair && turn === 3
                  ? 'Invented quotation for the repair fixture.'
                  : this.read.text,
            },
          ],
        },
      ],
      uncertainty: ['The source alone does not establish the root cause.'],
      missing: this.entry.question ? [this.entry.question] : [],
    });
  }
  async close(): Promise<void> {}
}
const nonnegative = z.number().finite().nonnegative();
const maybeNumber = nonnegative.nullable();
const checksSchema = z.strictObject({
  savedBrief: z.boolean(),
  expectedStatus: z.boolean(),
  citationsValid: z.boolean(),
  requiredCoverage: z.boolean(),
  noUnexpectedCitations: z.boolean(),
  missingInformation: z.boolean(),
  noDuplicateBriefs: z.boolean(),
});
const metricsSchema = z.strictObject({
  calls: nonnegative.int().nullable(),
  repairs: nonnegative.int().nullable(),
  latencyMs: nonnegative,
  generatorInputTokens: maybeNumber,
  generatorOutputTokens: maybeNumber,
  loadMs: maybeNumber,
  selectorDecisionCalls: maybeNumber,
  selectorFallbacks: nonnegative.int(),
  selectorUsage: z.array(z.unknown()),
  estimatedInputTokens: nonnegative,
  parentRssBefore: nonnegative,
  parentRssAfter: nonnegative,
  parentRssSampledPeak: nonnegative,
  systemFreeBefore: nonnegative,
  systemFreeAfter: nonnegative,
});
const resultSchema = z.strictObject({
  caseId: z.string().min(1),
  trial: z.number().int().positive(),
  success: z.boolean(),
  status: z.string(),
  checks: checksSchema,
  requiredEvidenceCoverage: nonnegative.max(1),
  incorrectRecordIds: z.array(z.string()),
  omittedRecordIds: z.array(z.string()),
  failure: z.string().nullable(),
  metrics: metricsSchema,
});
export const reportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  suiteId: z.string(),
  datasetHash: z.string(),
  generatedAt: z.iso.datetime({ offset: true }),
  config: z.strictObject({
    harnessHash: z.string().min(1),
    mode: z.enum(['live', 'replay']),
    selector: z.enum(['deterministic', 'laya']),
    generator: z.string(),
    sdkVersion: z.string().nullable(),
    ctxSize: z.number().int().positive().nullable(),
    maxCalls: z.number().int().positive(),
    maxRepairs: z.number().int().nonnegative(),
    contextBudget: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    trials: z.number().int().positive(),
    caseIds: z.array(z.string().min(1)).min(1),
    temperature: z.number().nullable(),
    topP: z.number().nullable(),
    topK: z.number().int().nullable(),
    minP: z.number().nullable(),
    reasoningBudget: z.number().int().nullable(),
    lifecycle: z.string(),
  }),
  memoryScope: z.string(),
  limitations: z.array(z.string()),
  results: z.array(resultSchema),
});
export type EvalReport = z.infer<typeof reportSchema>;
export type EvalResult = z.infer<typeof resultSchema>;
export interface EvaluationOptions {
  mode: 'live' | 'replay';
  selector: 'deterministic' | 'laya';
  trials: number;
  modelCandidate?: '0.6b' | '1.7b';
}
export function validateReport(input: unknown): EvalReport {
  const report = reportSchema.parse(input);
  const ids = report.config.caseIds;
  if (report.config.mode === 'replay' && report.config.selector !== 'deterministic')
    throw new Error('Replay reports cannot claim live Laya selection');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate configured case IDs');
  const seen = new Set<string>();
  for (const item of report.results) {
    const key = `${item.caseId}:${item.trial}`;
    if (seen.has(key)) throw new Error(`Duplicate case/trial identity: ${key}`);
    if (!ids.includes(item.caseId) || item.trial > report.config.trials)
      throw new Error(`Unexpected case/trial identity: ${key}`);
    if (item.success !== Object.values(item.checks).every(Boolean))
      throw new Error(`Inconsistent pass result: ${key}`);
    seen.add(key);
  }
  for (const id of ids)
    for (let trial = 1; trial <= report.config.trials; trial++)
      if (!seen.has(`${id}:${trial}`))
        throw new Error(`Missing case/trial identity: ${id}:${trial}`);
  return report;
}
export function compareReports(baselineInput: unknown, currentInput: unknown) {
  const baseline = validateReport(baselineInput),
    current = validateReport(currentInput);
  if (baseline.suiteId !== current.suiteId || baseline.datasetHash !== current.datasetHash)
    throw new Error('Incompatible evaluation suites or datasets');
  const comparable = (report: EvalReport) => {
    const { selector: _selector, caseIds, ...config } = report.config;
    return JSON.stringify({ ...config, caseIds: [...caseIds].sort() });
  };
  if (comparable(baseline) !== comparable(current))
    throw new Error('Incompatible model, mode, budget, trial, or case configurations');
  const old = new Map(baseline.results.map((item) => [`${item.caseId}:${item.trial}`, item]));
  const cases = current.results.map((item) => {
    const before = old.get(`${item.caseId}:${item.trial}`)!;
    return {
      caseId: item.caseId,
      trial: item.trial,
      before: before.success,
      after: item.success,
      regression: before.success && !item.success,
      latencyDeltaMs: item.metrics.latencyMs - before.metrics.latencyMs,
      inputTokenDelta:
        before.metrics.generatorInputTokens === null || item.metrics.generatorInputTokens === null
          ? null
          : item.metrics.generatorInputTokens - before.metrics.generatorInputTokens,
    };
  });
  return {
    schemaVersion: 1,
    suiteId: current.suiteId,
    baselineSelector: baseline.config.selector,
    currentSelector: current.config.selector,
    trials: current.config.trials,
    regression: cases.some((item) => item.regression),
    baselineSuccessRate:
      baseline.results.filter((item) => item.success).length / baseline.results.length,
    currentSuccessRate:
      current.results.filter((item) => item.success).length / current.results.length,
    cases,
    limitations:
      'Small repeated-trial comparisons are descriptive. Replay results measure fixture behavior, not model quality or statistical significance.',
  };
}
function recordNumber(value: unknown, key: string): number | null {
  if (value === null || typeof value !== 'object') return null;
  const n = (value as Record<string, unknown>)[key];
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}
function sumKnown(values: Array<number | null>): number | null {
  return values.length && values.every((value) => value !== null)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
}
export function checkOutcome(
  entry: EvalCase,
  records: RelayRecord[],
  status: string,
  requiredId: string,
): Pick<
  EvalResult,
  'checks' | 'success' | 'requiredEvidenceCoverage' | 'incorrectRecordIds' | 'omittedRecordIds'
> {
  const briefs = records.filter((record): record is BriefRecord => record.kind === 'brief');
  const brief = briefs[0];
  const sources = brief?.facts.flatMap((fact) => fact.sources) ?? [];
  const cited = new Set(sources.map((source) => source.id));
  const incorrectRecordIds = [...cited].filter((id) => id !== requiredId).sort();
  const omittedRecordIds = cited.has(requiredId) ? [] : [requiredId];
  const checks = {
    savedBrief: Boolean(brief),
    expectedStatus: status === (entry.question ? 'pending' : 'completed'),
    citationsValid:
      sources.length > 0 &&
      sources.every((source) => {
        const evidence = records.find(
          (record) => record.kind === 'evidence' && record.id === source.id,
        );
        return Boolean(
          evidence &&
          evidence.kind === 'evidence' &&
          revision(evidence) === source.revision &&
          evidence.text.includes(source.quote),
        );
      }),
    requiredCoverage: omittedRecordIds.length === 0,
    noUnexpectedCitations: incorrectRecordIds.length === 0,
    missingInformation: entry.question
      ? Boolean(brief?.missing.length && records.some((record) => record.kind === 'request'))
      : Boolean(brief && brief.missing.length === 0),
    noDuplicateBriefs: briefs.length === 1,
  };
  return {
    checks,
    success: Object.values(checks).every(Boolean),
    requiredEvidenceCoverage: omittedRecordIds.length ? 0 : 1,
    incorrectRecordIds,
    omittedRecordIds,
  };
}
async function evaluateOne(
  entry: EvalCase,
  trial: number,
  model: Model,
  selector: Selector,
): Promise<EvalResult> {
  const directory = await mkdtemp(join(tmpdir(), 'relay-eval-'));
  let store: RelayStore | undefined;
  const parentRssBefore = process.memoryUsage().rss,
    systemFreeBefore = freemem();
  let peak = parentRssBefore;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 25);
  sampler.unref();
  const started = performance.now();
  try {
    store = await RelayStore.open(directory);
    const caseId = entry.id;
    const createdAt = new Date().toISOString();
    const base = { schemaVersion: 1, owner: store.owner, caseId, createdAt };
    await store.put(
      parseRecord({
        ...base,
        id: `${caseId}-case`,
        kind: 'case',
        title: entry.title,
        task: entry.task,
      }),
    );
    const requiredId = `${caseId}-source`;
    await store.put(
      parseRecord({
        ...base,
        id: requiredId,
        kind: 'evidence',
        title: entry.sourceTitle,
        text: entry.sourceText,
      }),
    );
    for (let index = 0; index < 5; index++)
      await store.put(
        parseRecord({
          ...base,
          id: `${caseId}-noise-${index}`,
          kind: 'evidence',
          title: `Archived unrelated note ${index}`,
          text: `Office inventory entry ${index}: spare keyboards are stored on shelf B.`,
        }),
      );
    const checkpoint = await new Agent(store, model).run(caseId, { ...LIMITS, selector });
    const records = await store.list(caseId);
    const lines = (await readFile(join(directory, 'traces', `${checkpoint.runId}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const modelEvents = lines.filter((line) => line.event === 'model');
    const contexts = lines.filter((line) => line.event === 'context');
    const selectorUsage = contexts.flatMap((line) => (line.usage ? [line.usage] : []));
    // Agent memoizes selector output; repeated contexts can carry the same usage object.
    const uniqueUsage = [
      ...new Map(selectorUsage.map((usage) => [JSON.stringify(usage), usage])).values(),
    ];
    const outcome = checkOutcome(entry, records, checkpoint.status, requiredId);
    const parentRssAfter = process.memoryUsage().rss;
    peak = Math.max(peak, parentRssAfter);
    return {
      caseId,
      trial,
      status: checkpoint.status,
      ...outcome,
      failure: checkpoint.reason ?? null,
      metrics: {
        calls: checkpoint.calls,
        repairs: checkpoint.repairs,
        latencyMs: performance.now() - started,
        generatorInputTokens: sumKnown(
          modelEvents.map((line) => recordNumber(line.stats, 'promptTokens')),
        ),
        generatorOutputTokens: sumKnown(
          modelEvents.map((line) => recordNumber(line.stats, 'generatedTokens')),
        ),
        loadMs: sumKnown(modelEvents.map((line) => recordNumber(line.stats, 'loadMs'))),
        selectorDecisionCalls: uniqueUsage.length
          ? sumKnown(uniqueUsage.map((usage) => recordNumber(usage, 'decisionCalls')))
          : selector instanceof DeterministicSelector
            ? 0
            : null,
        selectorFallbacks: contexts.filter((line) => line.fallback !== undefined).length,
        selectorUsage: uniqueUsage,
        estimatedInputTokens: contexts.reduce(
          (total, line) => total + (recordNumber(line, 'estimatedInputTokens') ?? 0),
          0,
        ),
        parentRssBefore,
        parentRssAfter,
        parentRssSampledPeak: peak,
        systemFreeBefore,
        systemFreeAfter: freemem(),
      },
    };
  } catch (error) {
    const checks = {
      savedBrief: false,
      expectedStatus: false,
      citationsValid: false,
      requiredCoverage: false,
      noUnexpectedCitations: false,
      missingInformation: false,
      noDuplicateBriefs: false,
    };
    const parentRssAfter = process.memoryUsage().rss;
    peak = Math.max(peak, parentRssAfter);
    return {
      caseId: entry.id,
      trial,
      status: 'infrastructure_error',
      success: false,
      checks,
      requiredEvidenceCoverage: 0,
      incorrectRecordIds: [],
      omittedRecordIds: [`${entry.id}-source`],
      failure: error instanceof Error ? error.message : String(error),
      metrics: {
        calls: null,
        repairs: null,
        latencyMs: performance.now() - started,
        generatorInputTokens: null,
        generatorOutputTokens: null,
        loadMs: null,
        selectorDecisionCalls: null,
        selectorFallbacks: 0,
        selectorUsage: [],
        estimatedInputTokens: 0,
        parentRssBefore,
        parentRssAfter,
        parentRssSampledPeak: peak,
        systemFreeBefore,
        systemFreeAfter: freemem(),
      },
    };
  } finally {
    clearInterval(sampler);
    await store?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
export async function runEvaluation(options: EvaluationOptions): Promise<EvalReport> {
  if (!Number.isInteger(options.trials) || options.trials < 1 || options.trials > 20)
    throw new Error('Trials must be an integer from 1 to 20');
  if (options.mode === 'replay' && options.selector !== 'deterministic')
    throw new Error(
      'Replay supports deterministic selection only; Laya requires explicitly selected live mode',
    );
  const candidate = options.modelCandidate ?? '0.6b';
  let liveModel: Model | undefined;
  let selector: Selector = new DeterministicSelector();
  if (options.mode === 'live') {
    const { QvacModel } = await import('./qvac.js');
    liveModel = new QvacModel(candidate);
    if (options.selector === 'laya') {
      const { LayaSelector } = await import('./laya.js');
      selector = new LayaSelector();
    }
  }
  const results: EvalResult[] = [];
  try {
    for (let trial = 1; trial <= options.trials; trial++)
      for (const entry of EVAL_CASES) {
        const model = liveModel ?? new ReplayModel(entry);
        try {
          const result = await evaluateOne(entry, trial, model, selector);
          results.push(result);
          console.error(
            JSON.stringify({
              event: 'evaluation-case',
              mode: options.mode,
              selector: options.selector,
              caseId: entry.id,
              trial,
              status: result.status,
              success: result.success,
              calls: result.metrics.calls,
              repairs: result.metrics.repairs,
              failure: result.failure,
            }),
          );
        } finally {
          if (!liveModel) await model.close();
        }
      }
  } finally {
    if ('close' in selector && typeof selector.close === 'function') await selector.close();
    await liveModel?.close();
  }
  return validateReport({
    schemaVersion: 1,
    suiteId: EVAL_SUITE_ID,
    datasetHash: EVAL_DATASET_HASH,
    generatedAt: new Date().toISOString(),
    config: {
      harnessHash: EVAL_HARNESS_HASH,
      mode: options.mode,
      selector: options.selector,
      generator: liveModel?.name ?? 'scripted-history-replay-v1-not-live',
      sdkVersion: options.mode === 'live' ? '0.22.0' : null,
      ctxSize: options.mode === 'live' ? 8192 : null,
      ...LIMITS,
      trials: options.trials,
      caseIds: EVAL_CASES.map((entry) => entry.id),
      temperature: options.mode === 'live' ? SAMPLING.temp : null,
      topP: options.mode === 'live' ? SAMPLING.top_p : null,
      topK: options.mode === 'live' ? SAMPLING.top_k : null,
      minP: null,
      reasoningBudget: options.mode === 'live' ? SAMPLING.reasoning_budget : null,
      lifecycle:
        options.mode === 'live'
          ? 'Generator unloaded before each task; subsequent turns warm within task. OS/file caches uncontrolled.'
          : 'Scripted protocol replay in fresh isolated stores; no model loading.',
    },
    memoryScope:
      '25 ms sampled parent Node process RSS and system free memory before/after. Native child worker memory is not attributed. This is not machine-wide peak model memory.',
    limitations: [
      'State checks verify shape, exact quotations, required fixture-source coverage and pending/completed outcome. They do not establish semantic truth.',
      'Three synthetic cases and small repeated trials do not establish statistical significance or general model accuracy.',
      'Replay is a scripted harness regression, not live inference. Every trial writes only isolated temporary stores that are removed after completion.',
      'Generator unloads between cases; no separate cross-task warm benchmark is claimed.',
      'Latency includes fixture-store setup and agent execution, and excludes cleanup. Selector fallbacks count context deliveries using fallback, not distinct native attempts.',
    ],
    results,
  });
}
