import type { completion } from '@qvac/sdk';
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
  ) {
    super(message);
    this.name = 'RelayError';
  }
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
