import type { completion } from '@qvac/sdk';
import { revision, type BriefRecord, type RelayRecord } from './records.js';
export type FailureKind =
  'validation' | 'model' | 'tool' | 'infrastructure' | 'cancelled' | 'overflow';
export const SAMPLING = {
  temp: 0.7,
  top_p: 0.8,
  top_k: 20,
  reasoning_budget: 0,
} as const satisfies NonNullable<Parameters<typeof completion>[0]['generationParams']>;
export class RelayError extends Error {
  constructor(
    public code: string,
    message: string,
    public kind: FailureKind = 'validation',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RelayError';
  }
}
// Citation coverage applies to linked answers from any owner. Scheduling new
// remote work is separate from deciding whether an accepted brief is current.
export function uncitedContributions(
  records: readonly RelayRecord[],
  requestIds: readonly string[],
  brief: BriefRecord,
): string[] {
  const requested = new Set(requestIds);
  return records
    .filter(
      (record) =>
        record.kind === 'evidence' &&
        record.requestId &&
        requested.has(record.requestId) &&
        !brief.facts.some((fact) =>
          fact.sources.some(
            (source) => source.id === record.id && source.revision === revision(record),
          ),
        ),
    )
    .map((record) => record.id)
    .sort();
}
export function classify(error: unknown): FailureKind {
  if (error instanceof RelayError) return error.kind;
  if (
    error instanceof Error &&
    ['AbortError', 'InferenceCancelledError', 'INFERENCE_CANCELLED'].includes(error.name)
  )
    return 'cancelled';
  if (error instanceof Error && error.name === 'CONTEXT_OVERFLOW') return 'overflow';
  return 'infrastructure';
}
export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new RelayError('CANCELLED', 'Work cancelled.', 'cancelled');
}
export function failureSignature(error: unknown): string {
  return error instanceof RelayError
    ? `${error.kind}:${error.code}:${error.message}`
    : 'infrastructure:unknown';
}
export function repairDecision(
  repairs: number,
  previous: string | undefined,
  signature: string,
  kind: FailureKind,
  maxRepairs = 2,
): 'repair' | 'stop' {
  return kind === 'validation' && repairs < maxRepairs && signature !== previous
    ? 'repair'
    : 'stop';
}
