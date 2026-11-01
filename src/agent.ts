import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { RelayStore } from './store.js';
import {
  idSchema,
  parseRecord,
  revision,
  stableId,
  type BriefRecord,
  type CheckpointRecord,
  type RelayRecord,
} from './records.js';
import { buildContext, DeterministicSelector, type Selector } from './context.js';
import type { Message, Model, ToolSpec } from './qvac.js';
import { PassageIndex } from './retrieval.js';
import { fitsToolResult } from './tool-budget.js';
import {
  checkCancelled,
  classify,
  failureSignature,
  RelayError,
  repairDecision,
  uncitedContributions,
} from './policy.js';

const schemas = {
  find_evidence: z.strictObject({
    query: z.string().max(200),
    skip: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 13)
      .optional(),
    limit: z.number().int().min(1).max(12).optional(),
  }),
  read_record: z.strictObject({
    id: idSchema,
    offset: z.number().int().min(0).max(15999).optional(),
    length: z.number().int().min(1).max(1000).optional(),
  }),
  request_information: z.strictObject({
    question: z.string().trim().min(1).max(500),
    needId: idSchema.optional(),
  }),
  save_brief: z.strictObject({
    facts: z
      .array(
        z.strictObject({
          text: z.string().trim().min(1).max(600).optional(),
          sources: z
            .array(
              z.strictObject({
                id: idSchema,
                quote: z.string().min(1).max(1000),
                revision: z
                  .string()
                  .regex(/^[a-f0-9]{64}$/)
                  .optional(),
              }),
            )
            .min(1)
            .max(3)
            .refine(
              (sources) => new Set(sources.map((s) => s.id)).size === sources.length,
              'Remove duplicate citations.',
            ),
        }),
      )
      .min(1)
      .max(3),
    uncertainty: z
      .array(z.string().trim().min(1).max(400))
      .max(3)
      .refine(
        (values) => new Set(values).size === values.length,
        'Remove duplicate uncertainty entries.',
      ),
    missing: z
      .array(z.string().trim().min(1).max(400))
      .max(3)
      .refine(
        (values) => new Set(values).size === values.length,
        'Remove duplicate missing entries.',
      ),
  }),
};
export const TOOLS: ToolSpec[] = Object.entries(schemas).map(([name, schema]) => ({
  name,
  description: (
    {
      find_evidence:
        'Search all passages. Returns a bounded page of source IDs and exact locations, not source text. Read matching offsets before citing. Use nextSkip for the next page.',
      read_record:
        'Read exact original text using source ID and offset from search/context. Trusted code returns up to1000 characters, possibly fewer to fit context. Follow nextOffset for more. Offsets are UTF-16 characters, not passage IDs.',
      request_information:
        'Persist a question for another peer. For a required informationNeed include its needId. Reuse existing questions.',
      save_brief:
        'Save source observations as exact quotes, with uncertainty and missing questions. Do not add generated explanations to facts. Revision is optional; trusted code attaches the version read. Persist missing questions before saving.',
    } as Record<string, string>
  )[name]!,
  parameters: z.toJSONSchema(schema) as Record<string, unknown>,
}));
interface SchemaNode {
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  enum?: string[];
  required?: string[];
}
function offerTools(
  readIds: string[],
  requiredIds: string[],
  knownIds: string[],
  needIds: string[],
): ToolSpec[] {
  const canSave = readIds.length > 0 && requiredIds.every((id) => readIds.includes(id));
  const readable = [...new Set([...requiredIds, ...readIds, ...knownIds])].sort();
  return TOOLS.filter(
    (tool) =>
      (tool.name !== 'save_brief' || canSave) &&
      (tool.name !== 'read_record' || readable.length > 0),
  ).map((tool) => {
    if (tool.name === 'request_information') {
      const parameters = structuredClone(tool.parameters),
        properties = (parameters as SchemaNode).properties;
      if (!properties)
        throw new RelayError(
          'TOOL_SCHEMA',
          'Trusted request schema is unavailable.',
          'infrastructure',
        );
      if (needIds.length) properties.needId!.enum = [...needIds];
      else delete properties.needId;
      return { ...tool, parameters };
    }
    if (tool.name === 'read_record') {
      const parameters = structuredClone(tool.parameters);
      const id = (parameters as SchemaNode).properties?.id;
      if (!id)
        throw new RelayError(
          'TOOL_SCHEMA',
          'Trusted read schema is unavailable.',
          'infrastructure',
        );
      id.enum = readable;
      // Page size is a harness budget decision, not a model counting task.
      // The library validator retains length for controlled callers/tests.
      delete (parameters as SchemaNode).properties!.length;
      return { ...tool, parameters };
    }
    if (tool.name !== 'save_brief') return tool;
    const parameters = structuredClone(tool.parameters);
    const factNode = (parameters as SchemaNode).properties?.facts?.items;
    if (factNode?.properties) {
      delete factNode.properties.text;
      factNode.required = factNode.required?.filter((field) => field !== 'text');
    }
    const sourceId = (parameters as SchemaNode).properties?.facts?.items?.properties?.sources?.items
      ?.properties?.id;
    if (!sourceId)
      throw new RelayError(
        'TOOL_SCHEMA',
        'Trusted source schema is unavailable.',
        'infrastructure',
      );
    sourceId.enum = [...readIds].sort();
    return { ...tool, parameters };
  });
}
export function validateArguments(name: string, args: unknown): Record<string, unknown> {
  if (!Object.hasOwn(schemas, name))
    throw new RelayError('UNKNOWN_TOOL', `Tool ${name} is not permitted.`);
  const parsed = schemas[name as keyof typeof schemas].safeParse(args);
  if (!parsed.success)
    throw new RelayError(
      'ARGUMENTS',
      JSON.stringify(
        parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      ).slice(0, 1800),
    );
  return parsed.data;
}
export function searchEvidence(records: RelayRecord[], query: string): RelayRecord[] {
  const evidence = records.filter((record) => record.kind === 'evidence');
  const exact = evidence.find((record) => record.id.toLowerCase() === query.trim().toLowerCase());
  if (exact) return [exact];
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter(
    (term) => !['the', 'and', 'for', 'with', 'about'].includes(term),
  );
  return evidence
    .map((record) => {
      const title = record.kind === 'evidence' ? record.title.toLowerCase() : '';
      const body = record.kind === 'evidence' ? record.text.toLowerCase() : '';
      return {
        record,
        score: terms.reduce(
          (score, term) => score + (title.includes(term) ? 2 : 0) + (body.includes(term) ? 1 : 0),
          0,
        ),
      };
    })
    .filter((item) => !terms.length || item.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
    .slice(0, 12)
    .map((item) => item.record);
}
export function latestCheckpoint(
  records: RelayRecord[],
  owner: string,
): CheckpointRecord | undefined {
  return records
    .filter((r): r is CheckpointRecord => r.kind === 'checkpoint' && r.owner === owner)
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.calls - a.calls ||
        b.id.localeCompare(a.id),
    )[0];
}
export function contributions(records: RelayRecord[], checkpoint: CheckpointRecord): string[] {
  return records
    .filter(
      (r) =>
        r.kind === 'evidence' &&
        r.owner !== checkpoint.owner &&
        r.requestId &&
        checkpoint.requestIds.includes(r.requestId) &&
        !checkpoint.consumed.includes(r.id),
    )
    .map((r) => r.id)
    .sort();
}
export interface RunOptions {
  signal?: AbortSignal;
  selector?: Selector;
  runId?: string;
  consumed?: string[];
  requiredIds?: string[];
  maxCalls?: number;
  maxRepairs?: number;
  contextBudget?: number;
  timeoutMs?: number;
  initialCalls?: number;
  initialRepairs?: number;
  initialFailure?: string;
}
export class Agent {
  private active = false;
  lastCleanupError?: string;
  private controller?: AbortController;
  private readonly index = new PassageIndex();
  get isActive(): boolean {
    return this.active;
  }
  cancel(): void {
    this.controller?.abort(new DOMException('User cancelled', 'AbortError'));
  }
  constructor(
    readonly store: RelayStore,
    readonly model: Model,
  ) {}
  private async trace(runId: string, event: string, data: Record<string, unknown>): Promise<void> {
    const directory = join(this.store.directory, 'traces');
    await mkdir(directory, { recursive: true });
    await appendFile(
      join(directory, `${runId}.jsonl`),
      JSON.stringify({
        at: new Date().toISOString(),
        runId,
        peer: this.store.owner,
        event,
        ...data,
      }) + '\n',
    );
  }
  async run(caseId: string, options: RunOptions = {}): Promise<CheckpointRecord> {
    if (this.active)
      throw new RelayError('BUSY', 'This peer already has active work.', 'infrastructure');
    idSchema.parse(caseId);
    if (options.runId) idSchema.parse(options.runId);
    const timeoutMs = options.timeoutMs ?? 180_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000)
      throw new RelayError('OPTIONS', 'timeoutMs must be between1 and3600000.');
    for (const value of [
      options.maxCalls ?? 10,
      options.maxRepairs ?? 2,
      options.initialCalls ?? 0,
      options.initialRepairs ?? 0,
    ])
      if (!Number.isSafeInteger(value) || value < 0 || value > 1000)
        throw new RelayError('OPTIONS', 'Attempt counters must be integers between0 and1000.');
    this.active = true;
    this.controller = new AbortController();
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([
      this.controller.signal,
      deadline,
      ...(options.signal ? [options.signal] : []),
    ]);
    const runId = options.runId ?? randomUUID();
    let calls = options.initialCalls ?? 0,
      repairs = options.initialRepairs ?? 0,
      lastFailure = options.initialFailure;
    let briefId: string | undefined;
    let committedBrief: BriefRecord | undefined;
    let reason: string | undefined;
    let requestIds: string[] = [];
    const consumed = [...new Set(options.consumed ?? [])].sort();
    let task = '';
    const requiredIds = new Set(options.requiredIds ?? []);
    let clock = Date.now();
    let sequence = 0;
    const stamp = () => new Date((clock = Math.max(Date.now(), clock + 1))).toISOString();
    const checkpoint = async (status: CheckpointRecord['status']) => {
      const record = parseRecord({
        schemaVersion: 1,
        kind: 'checkpoint',
        id: stableId(runId, 'checkpoint', String(sequence++)),
        owner: this.store.owner,
        caseId,
        createdAt: stamp(),
        runId,
        status,
        task,
        calls,
        repairs,
        consumed,
        requestIds,
        ...(requiredIds.size ? { requiredIds: [...requiredIds].sort() } : {}),
        ...(lastFailure ? { lastFailure } : {}),
        ...(briefId ? { briefId } : {}),
        ...(reason ? { reason } : {}),
      }) as CheckpointRecord;
      await this.store.put(record);
      await this.trace(runId, 'transition', { status, calls, repairs, reason });
      return record;
    };
    try {
      checkCancelled(signal);
      let snapshot = await this.store.snapshot(caseId);
      // Owned records provide a logical lower bound if the host clock moves
      // backwards between runs. Remote peer clocks cannot advance our clock.
      clock = snapshot.records.reduce(
        (latest, record) =>
          record.owner === this.store.owner
            ? Math.max(latest, Date.parse(record.createdAt))
            : latest,
        clock,
      );
      const cases = snapshot.records.filter((r) => r.kind === 'case');
      if (cases.length !== 1 || cases[0]!.owner !== this.store.owner)
        throw new RelayError(
          'CASE_OWNER',
          'Exactly one local-owned case is required.',
          'infrastructure',
        );
      task = cases[0]!.kind === 'case' ? cases[0]!.task : '';
      const existingRun = snapshot.records
        .filter(
          (r): r is CheckpointRecord =>
            r.kind === 'checkpoint' && r.runId === runId && r.owner === this.store.owner,
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      if (existingRun) return existingRun;
      clock = Math.max(
        clock,
        ...snapshot.records
          .filter((r) => r.kind === 'checkpoint' && r.owner === this.store.owner)
          .map((r) => Date.parse(r.createdAt)),
      );
      requestIds = snapshot.records
        .filter((r) => r.kind === 'request' && r.owner === this.store.owner)
        .map((r) => r.id);
      await checkpoint('running');
      await this.trace(runId, 'start', {
        model: this.model.name,
        configuration: this.model.configuration ?? null,
        requiredIds: options.requiredIds ?? [],
        consumed,
        budgets: {
          calls: options.maxCalls ?? 10,
          repairs: options.maxRepairs ?? 2,
          context: options.contextBudget ?? 7000,
        },
      });
      const read = new Map<string, { revision: string; text: string; excerpts: string[] }>();
      const knownIds = new Set(
        snapshot.records
          .filter((record) => record.kind === 'evidence')
          .slice(0, 12)
          .map((record) => record.id),
      );
      const usedCallIds = new Set<string>();
      const actions = new Map<string, number>();
      let history: Message[] = [];
      let feedback: string | undefined;
      let discardRejectedDraft = false;
      const selector = options.selector ?? new DeterministicSelector();
      let cachedKey = '';
      let cached: Awaited<ReturnType<Selector['select']>> | undefined;
      const memo: Selector = {
        select: async (t, c, s) => {
          const key = stableId(t, JSON.stringify(c));
          if (key !== cachedKey) {
            if (!(
              selector instanceof DeterministicSelector &&
              selector.select === DeterministicSelector.prototype.select
            ))
              await this.model.release?.();
            try {
              cached = await selector.select(t, c, s);
              if (
                new Set(cached.ids).size !== cached.ids.length ||
                cached.ids.some((id) => !c.some((v) => v.id === id))
              )
                throw new Error('Invalid selector IDs');
            } catch (error) {
              if (error instanceof RelayError && error.code === 'MODEL_RELEASE_FAILED') throw error;
              checkCancelled(s);
              cached = {
                ...(await new DeterministicSelector().select(t, c)),
                fallback: String(error),
              };
            }
            cachedKey = key;
          }
          return cached!;
        },
      };
      for (; calls < (options.maxCalls ?? 10);) {
        checkCancelled(signal);
        snapshot = await this.store.snapshot(caseId);
        for (const record of snapshot.records)
          if (
            record.kind === 'evidence' &&
            record.owner !== this.store.owner &&
            record.requestId &&
            requestIds.includes(record.requestId)
          )
            requiredIds.add(record.id);
        this.index.sync(snapshot.records);
        for (const [id, cached] of read) {
          if (
            !snapshot.records.some(
              (record) =>
                record.kind === 'evidence' &&
                record.id === id &&
                revision(record) === cached.revision,
            )
          )
            read.delete(id);
        }
        for (const { passage } of this.index.search(task, 12)) {
          knownIds.delete(passage.sourceId);
          knownIds.add(passage.sourceId);
        }
        const tools = offerTools(
          [...read.keys()],
          [...requiredIds],
          [...knownIds].slice(-24),
          snapshot.records
            .find((r) => r.kind === 'case')
            ?.informationNeeds?.map((need) => need.id) ?? [],
        );
        const context = await buildContext({
          task,
          records: snapshot.records,
          history,
          tools,
          selector: memo,
          requiredIds: [...requiredIds],
          signal,
          budget: options.contextBudget,
          feedback,
          readIds: [...read]
            .filter(([id, cached]) =>
              snapshot.records.some(
                (record) =>
                  record.kind === 'evidence' &&
                  record.id === id &&
                  revision(record) === cached.revision,
              ),
            )
            .map(([id]) => id),
          discardRejectedDraft,
        });
        history = context.history.filter(
          (message) => message.role === 'assistant' || message.role === 'tool',
        );
        await this.trace(runId, 'context', {
          ...context.selection,
          allowedTools: tools.map((t) => t.name),
          estimatedInputTokens: context.estimatedTokens,
          tokenAccounting: 'conservative UTF-8 byte estimate plus template allowance',
          fingerprint: snapshot.fingerprint,
        });
        calls++;
        await checkpoint('running');
        let reply;
        try {
          reply = await this.model.complete(context.history, tools, signal);
        } catch (error) {
          if (error instanceof RelayError && error.kind === 'infrastructure') throw error;
          if (classify(error) === 'cancelled' || signal.aborted)
            throw new RelayError('CANCELLED', 'Inference cancelled.', 'cancelled');
          if (classify(error) === 'overflow')
            throw new RelayError(
              'NATIVE_CONTEXT_OVERFLOW',
              'Native context overflow despite the input estimate. Reduce evidence or context budget.',
              'overflow',
            );
          throw new RelayError(
            'MODEL_FAILED',
            error instanceof Error ? error.message : String(error),
            'model',
          );
        }
        checkCancelled(signal);
        await this.trace(runId, 'model', {
          stopReason: reply.stopReason,
          stats: reply.stats,
          calls: reply.calls.map((c) => ({ id: c.id, name: c.name })),
          toolErrorCount: reply.toolErrors.length,
        });
        if (reply.calls.length === 0) {
          const error = new RelayError(
            reply.stopReason === 'length'
              ? 'OUTPUT_LIMIT'
              : reply.toolErrors.length
                ? 'MALFORMED_CALL'
                : 'NO_ACTION',
            reply.stopReason === 'length'
              ? 'The response reached its output limit without a complete action. Emit one short declared tool call. Use concise questions and exact source quotes; do not write prose instead of a tool call.'
              : reply.toolErrors.length
                ? 'Native tool output was malformed. Emit a valid declared tool.'
                : 'No brief saved. Use a tool to investigate or save_brief.',
          );
          const signature = failureSignature(error);
          if (
            repairDecision(
              repairs,
              lastFailure,
              signature,
              'validation',
              options.maxRepairs ?? 2,
            ) === 'stop'
          )
            throw error;
          lastFailure = signature;
          repairs++;
          feedback = error.message;
          await checkpoint('running');
          continue;
        }
        const ids = new Set<string>();
        if (reply.calls.some((c) => !c.id || ids.has(c.id) || !ids.add(c.id)))
          throw new RelayError('CALL_IDS', 'Invalid or duplicate model call IDs.', 'model');
        if ([...ids].some((id) => usedCallIds.has(id)))
          throw new RelayError('CALL_IDS', 'Reused model call ID.', 'model');
        for (const id of ids) usedCallIds.add(id);
        const assistant: Message = { role: 'assistant', content: '', toolCalls: reply.calls };
        history.push(assistant);
        const turnResults: Message[] = [];
        let turnError: unknown;
        let saved = false;
        const unsafeBatch =
          reply.calls.length > 1 &&
          reply.calls.some((call) => !['find_evidence', 'read_record'].includes(call.name));
        for (const call of reply.calls) {
          let result: unknown;
          let readLocation: Record<string, unknown> | undefined;
          const resultBudget = Math.floor(
            Math.max(256, (options.contextBudget ?? 7000) - 6000) / reply.calls.length,
          );
          try {
            checkCancelled(signal);
            if (reply.toolErrors.length)
              throw new RelayError(
                'MALFORMED_CALL',
                'Native output contains malformed tool regions. No actions from this reply were executed; emit valid declared calls.',
              );
            if (unsafeBatch)
              throw new RelayError(
                'PARALLEL_DENIED',
                'Only independent evidence reads may share a turn. Submit writes on a separate turn.',
              );
            const args = validateArguments(call.name, call.arguments);
            if (!tools.some((tool) => tool.name === call.name))
              throw new RelayError(
                'PERMISSION',
                'This action is unavailable until the required evidence has been read.',
              );
            const current = await this.store.snapshot(caseId);
            checkCancelled(signal);
            const fits = async (body: unknown, readId?: string, discovered: string[] = []) => {
              const freshReads = [...read]
                .filter(([id, cached]) =>
                  current.records.some(
                    (record) =>
                      record.kind === 'evidence' &&
                      record.id === id &&
                      revision(record) === cached.revision,
                  ),
                )
                .map(([id]) => id);
              if (readId && !freshReads.includes(readId)) freshReads.push(readId);
              const futureKnown = new Set(knownIds);
              for (const id of discovered) {
                futureKnown.delete(id);
                futureKnown.add(id);
              }
              this.index.sync(current.records);
              for (const { passage } of this.index.search(task, 12)) {
                futureKnown.delete(passage.sourceId);
                futureKnown.add(passage.sourceId);
              }
              // A later independent read can enable the larger save schema.
              // Reserve that future schema now, without marking it actually read.
              for (const pending of reply.calls.slice(turnResults.length + 1)) {
                if (pending.name !== 'read_record') continue;
                const parsed = schemas.read_record.safeParse(pending.arguments);
                if (
                  parsed.success &&
                  current.records.some(
                    (record) => record.kind === 'evidence' && record.id === parsed.data.id,
                  ) &&
                  !freshReads.includes(parsed.data.id)
                )
                  freshReads.push(parsed.data.id);
              }
              return fitsToolResult({
                task,
                records: current.records,
                requiredIds: [...requiredIds],
                readIds: freshReads,
                tools: offerTools(
                  freshReads,
                  [...requiredIds],
                  [...futureKnown].slice(-24),
                  current.records
                    .find((record) => record.kind === 'case')
                    ?.informationNeeds?.map((need) => need.id) ?? [],
                ),
                assistant,
                results: [
                  ...turnResults,
                  {
                    role: 'tool',
                    toolCallId: call.id,
                    toolName: call.name,
                    content: JSON.stringify(body),
                  },
                ],
                remainingCalls: reply.calls.slice(turnResults.length + 1),
                budget: options.contextBudget ?? 7000,
                signal,
              });
            };
            const actionKey = stableId(call.name, JSON.stringify(args), current.fingerprint);
            const repetitions = actions.get(actionKey) ?? 0;
            actions.set(actionKey, repetitions + 1);
            if (repetitions >= 2)
              throw new RelayError(
                'NO_PROGRESS',
                call.name === 'request_information'
                  ? 'This question is already recorded. Do not request it again. Save a pending brief using the evidence already read, or inspect contributed responses.'
                  : 'This action already returned a result twice against unchanged data. Use the existing result, read a relevant record, or request missing information.',
              );
            if (call.name === 'find_evidence') {
              this.index.sync(current.records);
              const skip = Number(args.skip ?? 0),
                limit = Number(args.limit ?? 3);
              const matches = this.index.search(String(args.query), skip + limit + 1).slice(skip);
              const found: Array<{
                id: string;
                passageId: string;
                offset: number;
                end: number;
                revision: string;
                title: string;
                lexicalScore: number;
                nextSkip?: number | null;
              }> = [];
              for (const { passage, score } of matches.slice(0, limit)) {
                const next = {
                  id: passage.sourceId,
                  passageId: passage.id,
                  offset: passage.start,
                  end: passage.end,
                  revision: passage.revision,
                  title: passage.title.slice(0, 120),
                  lexicalScore: score,
                };
                if (Buffer.byteLength(JSON.stringify([...found, next]), 'utf8') > resultBudget - 40)
                  break;
                found.push(next);
              }
              while (found.length) {
                found.at(-1)!.nextSkip = matches.length > found.length ? skip + found.length : null;
                if (
                  await fits(
                    found,
                    undefined,
                    found.map((passage) => passage.id),
                  )
                )
                  break;
                found.pop();
              }
              if (
                (matches.length && !found.length) ||
                !(await fits(
                  found,
                  undefined,
                  found.map((passage) => passage.id),
                ))
              )
                throw new RelayError(
                  'SEARCH_RESULT_BUDGET',
                  reply.calls.length > 1
                    ? 'Search results do not fit this batch. Submit one search per turn.'
                    : 'A search location cannot fit the configured context budget. Increase contextBudget before starting another run.',
                  reply.calls.length > 1 ? 'validation' : 'overflow',
                );
              for (const passage of found) {
                knownIds.delete(passage.id);
                knownIds.add(passage.id);
              }
              result = found;
            } else if (call.name === 'read_record') {
              const record = current.records.find((r) => r.id === args.id && r.kind === 'evidence');
              if (!record || record.kind !== 'evidence')
                throw new RelayError(
                  'RECORD_NOT_FOUND',
                  `Evidence ${String(args.id)} is not available in this case.`,
                );
              const offset = Number(args.offset ?? 0),
                length = Number(args.length ?? 1000);
              if (offset >= record.text.length)
                throw new RelayError(
                  'READ_LOCATION',
                  'offset must point inside the original record.',
                );
              let text = record.text.slice(offset, offset + length);
              const page = (text: string) => ({
                id: record.id,
                revision: revision(record),
                text,
                offset,
                end: offset + text.length,
                totalLength: record.text.length,
                nextOffset: offset + text.length < record.text.length ? offset + text.length : null,
                truncated: offset > 0 || offset + text.length < record.text.length,
              });
              let bytes = Buffer.byteLength(JSON.stringify(page(text)), 'utf8');
              // A complete required passage can replace its duplicate index text.
              // Test that representation before shrinking: its total prompt cost
              // can be lower than a shorter, non-covering read page.
              const coveredRequiredFits =
                reply.calls.length === 1 &&
                requiredIds.has(record.id) &&
                (await fits(page(text), record.id));
              while (!coveredRequiredFits && text.length && bytes > resultBudget) {
                text = text.slice(
                  0,
                  Math.max(0, text.length - Math.max(1, Math.ceil((bytes - resultBudget) / 2))),
                );
                bytes = Buffer.byteLength(JSON.stringify(page(text)), 'utf8');
              }
              while (text.length && !(await fits(page(text), record.id))) {
                text = text.slice(0, Math.floor(text.length / 2));
                bytes = Buffer.byteLength(JSON.stringify(page(text)), 'utf8');
              }
              if (!text.length)
                throw new RelayError(
                  'READ_RESULT_BUDGET',
                  reply.calls.length > 1
                    ? 'This batch leaves no room for source text. Read one record per turn.'
                    : 'A read result cannot fit the configured context budget. Increase contextBudget before starting another run.',
                  reply.calls.length > 1 ? 'validation' : 'overflow',
                );
              const rev = revision(record),
                previous = read.get(record.id);
              const excerpts =
                previous?.revision === rev ? [...new Set([...previous.excerpts, text])] : [text];
              if (excerpts.length > 32)
                throw new RelayError(
                  'READ_LIMIT',
                  'At most32 distinct excerpts per record may be retained in a run.',
                  'overflow',
                );
              read.set(record.id, { revision: rev, text, excerpts });
              result = page(text);
              readLocation = {
                offset,
                end: offset + text.length,
                requestedLength: length,
                returnedLength: text.length,
                resultBytes: bytes,
              };
            } else if (call.name === 'request_information') {
              const needs =
                current.records.find((record) => record.kind === 'case')?.informationNeeds ?? [];
              const need =
                args.needId === undefined
                  ? undefined
                  : needs.find((need) => need.id === args.needId);
              if (args.needId !== undefined && !need)
                throw new RelayError(
                  'INFORMATION_NEED',
                  'needId must identify an informationNeed in this case.',
                );
              const question = need?.question ?? String(args.question);
              const id = need
                ? stableId(this.store.owner, caseId, 'need', need.id)
                : stableId(this.store.owner, caseId, 'request', question.toLowerCase());
              const existing = current.records.find((r) => r.id === id);
              const record =
                existing ??
                parseRecord({
                  schemaVersion: 1,
                  kind: 'request',
                  id,
                  owner: this.store.owner,
                  caseId,
                  createdAt: stamp(),
                  question,
                  ...(need ? { needId: need.id } : {}),
                });
              checkCancelled(signal);
              const requestWrite = await this.store.put(record);
              if (!requestIds.includes(id)) requestIds.push(id);
              const responseIds = current.records
                .filter((record) => record.kind === 'evidence' && record.requestId === id)
                .map((record) => record.id);
              result = {
                id,
                question,
                ...(need ? { needId: need.id } : {}),
                persisted: true,
                duplicate: requestWrite.duplicate,
                responseIds,
                status: responseIds.length ? 'answered' : 'awaiting-response',
                guidance: responseIds.length
                  ? 'The question has linked evidence. Read and cite those response IDs.'
                  : 'The question is recorded. Do not request it again. Save a pending brief from available evidence; a peer response can resume it later.',
              };
            } else if (call.name === 'save_brief') {
              if (current.fingerprint !== snapshot.fingerprint)
                throw new RelayError(
                  'STALE_CONTEXT',
                  'Locally available evidence changed. Read the new evidence before saving.',
                );
              const draft = schemas.save_brief.parse(args);
              const originalFacts = draft.facts.length;
              draft.facts = [
                ...new Map(draft.facts.map((fact) => [JSON.stringify(fact), fact])).values(),
              ];
              if (draft.facts.length !== originalFacts)
                await this.trace(runId, 'draft_normalized', {
                  removedExactDuplicateFacts: originalFacts - draft.facts.length,
                });
              const cited = new Set<string>();
              for (const fact of draft.facts)
                for (const source of fact.sources) {
                  const evidence = current.records.find(
                    (r) => r.id === source.id && r.kind === 'evidence',
                  );
                  const seen = read.get(source.id);
                  if (!evidence || !seen)
                    throw new RelayError(
                      'UNREAD_SOURCE',
                      `Read evidence ${source.id} before citing it.`,
                    );
                  if (!/\S/.test(source.quote))
                    throw new RelayError(
                      'QUOTE',
                      'Quote must contain non-whitespace text from the read source.',
                    );
                  if (
                    revision(evidence) !== seen.revision ||
                    (source.revision !== undefined && seen.revision !== source.revision)
                  )
                    throw new RelayError('REVISION', `Use the current revision for ${source.id}.`);
                  if (!seen.excerpts.some((text) => text.includes(source.quote)))
                    throw new RelayError(
                      'QUOTE',
                      `Quote must be an exact substring of the read result for ${source.id}.`,
                    );
                  cited.add(source.id);
                }
              for (const id of requiredIds)
                if (!cited.has(id))
                  throw new RelayError('COVERAGE', `Cite required contribution ${id}.`);
              const needs =
                current.records.find((record) => record.kind === 'case')?.informationNeeds ?? [];
              for (const need of needs) {
                const request = current.records.find(
                  (record) =>
                    record.kind === 'request' &&
                    record.owner === this.store.owner &&
                    record.needId === need.id,
                );
                if (!request)
                  throw new RelayError(
                    'REQUIRED_INFORMATION_REQUEST',
                    `Required question is untracked. Call request_information with needId "${need.id}" and question "${need.question}" before saving. An empty missing list cannot satisfy this requirement.`,
                  );
                for (const response of current.records.filter(
                  (record) => record.kind === 'evidence' && record.requestId === request.id,
                ))
                  if (!cited.has(response.id))
                    throw new RelayError(
                      'COVERAGE',
                      `Read and cite required answer ${response.id} for informationNeed ${need.id}.`,
                    );
              }
              const open = current.records.filter(
                (r) =>
                  r.kind === 'request' &&
                  r.owner === this.store.owner &&
                  !current.records.some((e) => e.kind === 'evidence' && e.requestId === r.id),
              );
              if (draft.missing.length && !open.length)
                throw new RelayError(
                  'REQUEST_REQUIRED',
                  'Persist a request_information question for missing evidence before saving.',
                );
              const missing = [
                ...new Set([
                  ...draft.missing,
                  ...open.map((record) => (record.kind === 'request' ? record.question : '')),
                ]),
              ];
              if (missing.length > 32)
                throw new RelayError(
                  'REQUEST_LIMIT',
                  'Unresolved questions exceed the bounded brief capacity.',
                  'overflow',
                );
              if (missing.length !== draft.missing.length)
                await this.trace(runId, 'missing_projected', {
                  requestIds: open.map((record) => record.id),
                  added: missing.length - draft.missing.length,
                });
              const observations = draft.facts.flatMap((fact) =>
                fact.sources.map((source) => ({
                  text: source.quote,
                  sources: [{ ...source, revision: read.get(source.id)!.revision }],
                })),
              );
              const facts = [
                ...new Map(observations.map((fact) => [JSON.stringify(fact), fact])).values(),
              ];
              const uncertainty = [
                ...new Set([
                  'Source quotations alone do not establish root cause.',
                  ...draft.uncertainty.map((text) => `Unverified model interpretation: ${text}`),
                  ...draft.facts.flatMap((fact) =>
                    fact.text ? [`Unverified model interpretation: ${fact.text}`] : [],
                  ),
                ]),
              ];
              await this.trace(runId, 'observations_projected', {
                policy: 'quoted-observations-v1',
                quoteCount: facts.length,
                interpretationCount: uncertainty.length - 1,
              });
              const record = parseRecord({
                schemaVersion: 1,
                kind: 'brief',
                id: stableId(runId, 'brief'),
                owner: this.store.owner,
                caseId,
                createdAt: stamp(),
                ...draft,
                factPolicy: 'quoted-observations-v1',
                uncertainty,
                missing,
                facts,
                basedOn: current.fingerprint,
              }) as BriefRecord;
              checkCancelled(signal);
              await this.store.put(record, { expectedFingerprint: current.fingerprint });
              committedBrief = record;
              briefId = record.id;
              saved = true;
              result = { id: record.id, persisted: true };
              for (const evidence of current.records)
                if (
                  evidence.kind === 'evidence' &&
                  evidence.owner !== this.store.owner &&
                  evidence.requestId &&
                  requestIds.includes(evidence.requestId) &&
                  cited.has(evidence.id) &&
                  !consumed.includes(evidence.id)
                )
                  consumed.push(evidence.id);
              consumed.sort();
            }
            await this.trace(runId, 'tool', {
              callId: call.id,
              name: call.name,
              ok: true,
              recordId:
                typeof result === 'object' && result !== null && 'id' in result
                  ? result.id
                  : undefined,
              ...(Array.isArray(result)
                ? { resultIds: result.map((r) => r.id), resultCount: result.length }
                : {}),
              ...(call.name === 'read_record'
                ? {
                    requestedId: args.id,
                    ...readLocation,
                  }
                : {}),
            });
          } catch (error) {
            const kind = classify(error);
            const signature = failureSignature(error);
            result = {
              ok: false,
              code: error instanceof RelayError ? error.code : 'TOOL_INFRASTRUCTURE',
              feedback: error instanceof Error ? error.message : String(error),
            };
            await this.trace(runId, 'validation', {
              callId: call.id,
              name: call.name,
              kind,
              signature,
            });
            if (turnError === undefined || kind !== 'validation') turnError = error;
          }
          const message: Message = {
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: JSON.stringify(result),
          };
          history.push(message);
          turnResults.push(message);
        }
        if (turnError !== undefined) {
          const kind = classify(turnError),
            signature = failureSignature(turnError);
          if (
            repairDecision(repairs, lastFailure, signature, kind, options.maxRepairs ?? 2) ===
            'stop'
          )
            throw turnError;
          repairs++;
          lastFailure = signature;
          feedback = turnError instanceof Error ? turnError.message : String(turnError);
          discardRejectedDraft =
            kind === 'validation' &&
            !saved &&
            reply.calls.length === 1 &&
            reply.calls[0]!.name === 'save_brief';
        } else {
          lastFailure = undefined;
          feedback = undefined;
          discardRejectedDraft = false;
        }
        if (saved) {
          const all = await this.store.list(caseId);
          if (!committedBrief)
            throw new RelayError(
              'BRIEF_STATE',
              'Committed brief state is unavailable.',
              'infrastructure',
            );
          const uncited = uncitedContributions(all, this.store.owner, requestIds, committedBrief);
          for (const id of uncited) requiredIds.add(id);
          if (uncited.length) {
            reason = 'New relevant evidence arrived after brief commit; refresh is pending.';
            await this.trace(runId, 'late_contribution', { ids: uncited });
          }
          const pending = all.some(
            (r) =>
              r.kind === 'request' &&
              requestIds.includes(r.id) &&
              !all.some((e) => e.kind === 'evidence' && e.requestId === r.id),
          );
          return await checkpoint(pending || uncited.length ? 'pending' : 'completed');
        }
        await checkpoint('running');
        // Retain complete protocol groups. Older resolved groups can leave context;
        // accepted writes and the trusted read cache remain outside prompt history.
        const groups: Message[][] = [];
        for (const message of history) {
          if (message.role === 'assistant') groups.push([message]);
          else groups.at(-1)!.push(message);
        }
        history = groups.slice(-2).flat();
      }
      throw new RelayError('CALL_BUDGET', 'Model call budget exhausted.', 'model');
    } catch (error) {
      reason =
        `${classify(error)}: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          2000,
        );
      await this.trace(runId, 'stop', { reason });
      if (!task) throw error;
      return await checkpoint(
        classify(error) === 'cancelled' || signal.aborted ? 'cancelled' : 'failed',
      );
    } finally {
      try {
        await this.model.release?.();
        this.lastCleanupError = undefined;
      } catch (error) {
        this.lastCleanupError = (error instanceof Error ? error.message : String(error)).slice(
          0,
          2000,
        );
        await this.trace(runId, 'cleanup_failed', {
          kind: 'infrastructure',
          code: error instanceof RelayError ? error.code : 'MODEL_RELEASE_FAILED',
          message: this.lastCleanupError,
        }).catch(() => undefined);
      } finally {
        this.active = false;
        this.controller = undefined;
      }
    }
  }
}
