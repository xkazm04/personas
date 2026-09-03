import { createLogger } from "@/lib/log";

const logger = createLogger("event-payloads");

/**
 * Typed payload validators for Tauri event listeners.
 *
 * Replaces ad-hoc `payload['field']` extractions with schema-validated,
 * fully-typed objects. Validation failures are logged as warnings instead
 * of silently producing undefined values.
 */

// ---------------------------------------------------------------------------
// Schema definition types
// ---------------------------------------------------------------------------

type PrimitiveType = 'string' | 'number' | 'boolean';

interface FieldDef {
  type: PrimitiveType | 'array' | 'object';
  optional?: true;
}

/** Map field definitions to their TypeScript types. */
type InferField<F extends FieldDef> =
  F extends { type: 'string' }  ? string :
  F extends { type: 'number' }  ? number :
  F extends { type: 'boolean' } ? boolean :
  F extends { type: 'array' }   ? unknown[] :
  F extends { type: 'object' }  ? Record<string, unknown> :
  unknown;

/** Infer the full output type from a schema definition. */
type InferSchema<S extends Record<string, FieldDef>> = {
  [K in keyof S as S[K] extends { optional: true } ? never : K]: InferField<S[K]>;
} & {
  [K in keyof S as S[K] extends { optional: true } ? K : never]?: InferField<S[K]>;
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an untyped event payload against a schema definition.
 *
 * Returns the typed object on success, or `null` if a required field is
 * missing / mis-typed (with a console.warn describing the mismatch).
 */
export function validatePayload<S extends Record<string, FieldDef>>(
  eventName: string,
  raw: Record<string, unknown>,
  schema: S,
): InferSchema<S> | null {
  const result: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(schema)) {
    const value = raw[key];

    if (value === undefined || value === null) {
      if (!def.optional) {
        logger.warn("Missing required field in event payload", { event: eventName, field: key });
        return null;
      }
      continue;
    }

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== def.type) {
      if (!def.optional) {
        logger.warn("Event payload field type mismatch", { event: eventName, field: key, expected: def.type, got: actualType });
        return null;
      }
      // Optional field with wrong type — skip it silently
      continue;
    }

    result[key] = value;
  }

  return result as InferSchema<S>;
}

// ---------------------------------------------------------------------------
// Event payload schemas
// ---------------------------------------------------------------------------

/** Schema for execution/CLI output events (line-based streaming). */
export const CliOutputSchema = {
  line: { type: 'string' as const },
} as const;

/**
 * Schema for execution status events.
 *
 * `status` is validated as a bare `string` here BY DESIGN, and that is not the
 * end of the check: this validator has no enum arm, and adding one would be
 * the wrong shape of gate anyway. A status token this frontend does not
 * recognise (a newer backend variant, a corrupted row) must still FINALIZE the
 * run -- rejecting the payload outright would drop the terminal event on the
 * floor and pin `isExecuting` for up to `RUN_MAX_DURATION_MS`.
 *
 * The narrowing happens at the ONE door instead: `usePersonaExecution`'s
 * `handleStatusEvent` runs every validated payload through
 * `parseExecutionState` (`lib/execution/executionState.ts`), which resolves
 * the legacy `pending` alias, names an unrecognised token as `'unknown'`
 * exactly once, and hands the closed union to `finishExecution`. Nothing
 * downstream of that door asserts a raw string into the union any more.
 */
export const ExecutionStatusSchema = {
  status: { type: 'string' as const },
  error: { type: 'string' as const, optional: true as const },
  duration_ms: { type: 'number' as const, optional: true as const },
  cost_usd: { type: 'number' as const, optional: true as const },
} as const;

/** Schema for AI healing output events. */
export const HealingOutputSchema = {
  persona_id: { type: 'string' as const },
  line: { type: 'string' as const },
} as const;

/** Schema for AI healing status events. */
export const HealingStatusSchema = {
  persona_id: { type: 'string' as const },
  phase: { type: 'string' as const },
  execution_id: { type: 'string' as const, optional: true as const },
  diagnosis: { type: 'string' as const, optional: true as const },
  fixes_applied: { type: 'array' as const, optional: true as const },
  should_retry: { type: 'boolean' as const, optional: true as const },
} as const;

// ---------------------------------------------------------------------------
// Inferred payload types (for use in consumer code)
// ---------------------------------------------------------------------------

export type CliOutputPayload = InferSchema<typeof CliOutputSchema>;
export type ExecutionStatusPayload = InferSchema<typeof ExecutionStatusSchema>;
export type HealingOutputPayload = InferSchema<typeof HealingOutputSchema>;
export type HealingStatusPayload = InferSchema<typeof HealingStatusSchema>;
