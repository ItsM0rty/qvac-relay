import { z } from 'zod';
import { idSchema } from './records.js';

const notes = z
  .array(z.string().trim().min(1).max(400))
  .max(3)
  .refine((values) => new Set(values).size === values.length, 'Duplicate entries are not allowed');
const envelope = z.strictObject({
  quotes: z.record(idSchema, z.string().min(1).max(1000)).superRefine((quotes, context) => {
    const count = Object.keys(quotes).length;
    if (count < 1 || count > 32)
      context.addIssue({ code: 'custom', message: `Provide 1..32 quotes; received ${count}.` });
  }),
  uncertainty: notes,
  missing: notes,
});

/** Compile a source-to-quote envelope without changing any quoted text. */
export function parseQuotedBrief(args: unknown): {
  facts: Array<{ sources: Array<{ id: string; quote: string }> }>;
  uncertainty: string[];
  missing: string[];
} {
  const parsed = envelope.parse(args);
  return {
    facts: Object.entries(parsed.quotes).map(([id, quote]) => ({ sources: [{ id, quote }] })),
    uncertainty: parsed.uncertainty,
    missing: parsed.missing,
  };
}

/** Native-facing schema restricts quote keys to read sources and requires mandatory IDs. */
export function quotedBriefParameters(
  readIds: string[],
  requiredIds: string[],
): Record<string, unknown> {
  if (new Set(readIds).size !== readIds.length || new Set(requiredIds).size !== requiredIds.length)
    throw new Error('Duplicate source IDs');
  for (const id of [...readIds, ...requiredIds]) idSchema.parse(id);
  if (requiredIds.length > 32) throw new Error('At most 32 required sources are supported');
  if (requiredIds.some((id) => !readIds.includes(id)))
    throw new Error('Required source has not been read');
  const noteSchema = {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 400 },
    maxItems: 3,
    uniqueItems: true,
  };
  return {
    type: 'object',
    properties: {
      quotes: {
        type: 'object',
        properties: Object.fromEntries(
          [...readIds].sort().map((id) => [id, { type: 'string', minLength: 1, maxLength: 1000 }]),
        ),
        // With one available key, nonempty means that key is required. Spell
        // out the equivalent constraint rather than relying on minProperties
        // alone in native tool generation. Runtime validation remains separate.
        required: [
          ...(requiredIds.length ? requiredIds : readIds.length === 1 ? readIds : []),
        ].sort(),
        additionalProperties: false,
        minProperties: 1,
        maxProperties: 32,
      },
      uncertainty: structuredClone(noteSchema),
      missing: structuredClone(noteSchema),
    },
    required: ['quotes', 'uncertainty', 'missing'],
    additionalProperties: false,
  };
}
