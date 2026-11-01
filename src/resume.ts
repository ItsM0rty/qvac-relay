import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { contributions, latestCheckpoint, type Agent, type RunOptions } from './agent.js';
import {
  parseRecord,
  stableId,
  type BriefRecord,
  type CheckpointRecord,
  type RelayRecord,
} from './records.js';
import { RelayStore } from './store.js';

type ResumableAgent = Pick<Agent, 'run'> & { readonly isActive?: boolean };
/** Coordinates one peer's automatic work. The caller owns the agent, model and store. */
export class Resumer {
  private running?: Promise<CheckpointRecord[]>;
  private controller?: AbortController;
  private timer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private watching = false;
  private closed = false;
  private dirty = false;
  lastError?: unknown;
  constructor(
    readonly store: RelayStore,
    private readonly agent: ResumableAgent,
    private readonly options: RunOptions = {},
  ) {}

  private async trace(event: string, data: Record<string, unknown>): Promise<void> {
    const directory = join(this.store.directory, 'traces');
    await mkdir(directory, { recursive: true });
    await appendFile(
      join(directory, 'resumption.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), peer: this.store.owner, event, ...data }) +
        '\n',
    );
  }
  private readonly change = (event: { remote?: boolean }): void => {
    if (!event.remote || this.closed) return;
    this.dirty = true;
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      this.backgroundScan();
    }, 25);
    this.debounce.unref();
  };
  private backgroundScan(): void {
    void this.scan().catch(async (error: unknown) => {
      this.lastError = error;
      await this.trace('scan_failed', {
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    });
  }
  start(intervalMs = 2000): void {
    if (this.closed) throw new Error('Resumer is closed');
    if (!Number.isInteger(intervalMs) || intervalMs < 100)
      throw new Error('Resumption interval must be at least 100 ms');
    if (this.watching) return;
    this.watching = true;
    this.store.on('change', this.change);
    this.timer = setInterval(() => this.backgroundScan(), intervalMs);
    this.timer.unref();
    this.backgroundScan();
  }
  scan(): Promise<CheckpointRecord[]> {
    if (this.closed) return Promise.resolve([]);
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    const operation = this.performScan();
    this.running = operation;
    void operation.then(
      () => {
        this.running = undefined;
      },
      () => {
        this.running = undefined;
      },
    );
    return operation;
  }
  private recoveryDepth(records: RelayRecord[], checkpoint: CheckpointRecord): number {
    let current = checkpoint.runId;
    let depth = 0;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const parent = records.find(
        (record): record is CheckpointRecord =>
          record.kind === 'checkpoint' &&
          record.owner === this.store.owner &&
          stableId('recovery', record.runId) === current,
      );
      if (!parent) break;
      depth++;
      current = parent.runId;
    }
    return depth;
  }
  private async settle(
    checkpoint: CheckpointRecord,
    status: CheckpointRecord['status'],
    reason: string,
    brief?: BriefRecord,
  ): Promise<CheckpointRecord> {
    const record = parseRecord({
      ...checkpoint,
      id: stableId(checkpoint.runId, 'resumer', status),
      createdAt: new Date(Math.max(Date.now(), Date.parse(checkpoint.createdAt) + 1)).toISOString(),
      status,
      reason,
      ...(brief ? { briefId: brief.id } : {}),
    }) as CheckpointRecord;
    await this.store.put(record);
    await this.trace('settled', { caseId: record.caseId, runId: record.runId, status, reason });
    return record;
  }
  private async performScan(): Promise<CheckpointRecord[]> {
    const outcomes: CheckpointRecord[] = [];
    do {
      this.dirty = false;
      if (this.closed || this.agent.isActive) break;
      const all = await this.store.list();
      const cases = all.filter(
        (record) => record.kind === 'case' && record.owner === this.store.owner,
      );
      for (const item of cases) {
        if (this.closed || this.agent.isActive) break;
        const records = all.filter((record) => record.caseId === item.caseId);
        const checkpoint = latestCheckpoint(records, this.store.owner);
        if (!checkpoint || !['pending', 'running'].includes(checkpoint.status)) continue;
        const incoming = contributions(records, checkpoint);
        const recovering = checkpoint.status === 'running';
        if (!recovering && incoming.length === 0) continue;
        // A saved brief can outlive the crash before its final checkpoint. Reuse it.
        const committed = records.find(
          (record): record is BriefRecord =>
            record.kind === 'brief' &&
            record.owner === this.store.owner &&
            record.id === stableId(checkpoint.runId, 'brief'),
        );
        if (recovering && committed) {
          const pending = checkpoint.requestIds.some(
            (id) =>
              !records.some((record) => record.kind === 'evidence' && record.requestId === id),
          );
          outcomes.push(
            await this.settle(
              checkpoint,
              pending ? 'pending' : 'completed',
              'Recovered already committed brief without repeating tool effects.',
              committed,
            ),
          );
          if (pending && incoming.length) this.dirty = true;
          continue;
        }
        if (
          checkpoint.calls >= (this.options.maxCalls ?? 10) ||
          (recovering && this.recoveryDepth(records, checkpoint) >= 2)
        ) {
          outcomes.push(
            await this.settle(
              checkpoint,
              'failed',
              'Automatic resumption stopped: cumulative call or crash-recovery budget exhausted.',
            ),
          );
          continue;
        }
        const runId = recovering
          ? stableId('recovery', checkpoint.runId)
          : stableId('resume', checkpoint.runId, ...incoming);
        const previousBrief = records.find(
          (record): record is BriefRecord =>
            record.kind === 'brief' &&
            record.id === checkpoint.briefId &&
            record.owner === this.store.owner,
        );
        const priorSources =
          previousBrief?.facts.flatMap((fact) => fact.sources.map((source) => source.id)) ?? [];
        const existing = records.filter(
          (record): record is CheckpointRecord =>
            record.kind === 'checkpoint' &&
            record.owner === this.store.owner &&
            record.runId === runId,
        );
        // Immutable persisted child checkpoints take precedence over repeated notifications.
        if (existing.length) continue;
        await this.trace('resume_started', {
          caseId: item.caseId,
          previousRunId: checkpoint.runId,
          runId,
          recovery: recovering,
          contributions: incoming,
          calls: checkpoint.calls,
          repairs: checkpoint.repairs,
        });
        this.controller = new AbortController();
        const signal = this.options.signal
          ? AbortSignal.any([this.options.signal, this.controller.signal])
          : this.controller.signal;
        try {
          const carried: RunOptions & { initialCalls: number; initialRepairs: number } = {
            ...this.options,
            signal,
            runId,
            consumed: [...new Set([...checkpoint.consumed, ...incoming])].sort(),
            requiredIds: [
              ...new Set([
                ...(this.options.requiredIds ?? []),
                ...(checkpoint.requiredIds ?? []),
                ...priorSources,
                ...(recovering ? checkpoint.consumed : []),
                ...incoming,
              ]),
            ].sort(),
            initialCalls: checkpoint.calls,
            initialRepairs: checkpoint.repairs,
            initialFailure: checkpoint.lastFailure,
          };
          outcomes.push(await this.agent.run(item.caseId, carried));
        } finally {
          this.controller = undefined;
        }
      }
    } while (this.dirty && !this.closed);
    return outcomes;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.store.off('change', this.change);
    this.controller?.abort(new DOMException('Resumer closed', 'AbortError'));
    await this.running?.catch(() => {});
  }
}
