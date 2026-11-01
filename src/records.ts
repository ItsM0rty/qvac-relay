import { createHash } from 'node:crypto';
import { z } from 'zod';

/** IDs are safe as a single tree-key component, including IDs supplied by users. */
export const idSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const ownerSchema = z.string().regex(/^[a-f0-9]{64}$/);
const shortText = z.string().trim().min(1).max(500);
const unique = (items: readonly string[]) => new Set(items).size === items.length;
const ids = z.array(idSchema).max(128).refine(unique, 'Duplicate IDs are not allowed');
const notes = z
  .array(z.string().trim().min(1).max(2000))
  .max(32)
  .refine(unique, 'Duplicate entries are not allowed');
const base = {
  id: idSchema,
  owner: ownerSchema,
  caseId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  schemaVersion: z.literal(1),
};
export const sourceSchema = z.strictObject({
  id: idSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  quote: z
    .string()
    .min(1)
    .max(4000)
    .refine((quote) => /\S/.test(quote), 'Quote must contain non-whitespace text'),
});
export const factSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  sources: z
    .array(sourceSchema)
    .min(1)
    .max(16)
    .refine(
      (sources) => unique(sources.map((source) => source.id)),
      'A fact cannot cite the same record twice',
    ),
});
export const caseSchema = z.strictObject({
  ...base,
  kind: z.literal('case'),
  title: shortText,
  task: z.string().trim().min(1).max(8000),
});
export const evidenceSchema = z.strictObject({
  ...base,
  kind: z.literal('evidence'),
  title: shortText,
  text: z.string().trim().min(1).max(16000),
  requestId: idSchema.optional(),
});
export const requestSchema = z.strictObject({
  ...base,
  kind: z.literal('request'),
  question: z.string().trim().min(1).max(2000),
});
export const briefSchema = z.strictObject({
  ...base,
  kind: z.literal('brief'),
  facts: z
    .array(factSchema)
    .min(1)
    .max(32)
    .refine((facts) => unique(facts.map((fact) => fact.text)), 'Duplicate facts are not allowed'),
  uncertainty: notes,
  missing: notes,
  basedOn: z.string().regex(/^[a-f0-9]{64}$/),
});
export const checkpointSchema = z.strictObject({
  ...base,
  kind: z.literal('checkpoint'),
  runId: idSchema,
  status: z.enum(['running', 'pending', 'completed', 'failed', 'cancelled']),
  task: z.string().trim().min(1).max(8000),
  calls: z.number().int().min(0).max(1000),
  repairs: z.number().int().min(0).max(1000),
  consumed: ids,
  lastFailure: z.string().min(1).max(4000).optional(),
  requiredIds: ids.optional(),
  briefId: idSchema.optional(),
  requestIds: ids,
  reason: z.string().min(1).max(2000).optional(),
});
export const recordSchema = z.discriminatedUnion('kind', [
  caseSchema,
  evidenceSchema,
  requestSchema,
  briefSchema,
  checkpointSchema,
]);
export type Source = z.infer<typeof sourceSchema>;
export type Fact = z.infer<typeof factSchema>;
export type CaseRecord = z.infer<typeof caseSchema>;
export type EvidenceRecord = z.infer<typeof evidenceSchema>;
export type RequestRecord = z.infer<typeof requestSchema>;
export type BriefRecord = z.infer<typeof briefSchema>;
export type CheckpointRecord = z.infer<typeof checkpointSchema>;
export type RelayRecord = z.infer<typeof recordSchema>;
export function parseRecord(input: unknown): RelayRecord {
  return recordSchema.parse(input);
}
/** Delimited serialization prevents ambiguous identities such as ('ab','c') / ('a','bc'). */
export function stableId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}
/** Hash accepted content, independent of JSON property insertion order. */
export function revision(record: RelayRecord): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(parseRecord(record))))
    .digest('hex');
}
