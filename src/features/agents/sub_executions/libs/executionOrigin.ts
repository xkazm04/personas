/**
 * Run-origin derivation for execution rows.
 *
 * The list projection (`ExecutionListItem`) carries a server-derived `origin`
 * + `origin_lane` (computed in SQL — see `LIST_ITEM_COLUMNS` in
 * `db/src/repos/execution/executions.rs`). Hydrated detail rows
 * (`PersonaExecution`) do NOT carry those fields but DO carry the raw
 * `input_data` / `trigger_id` / `is_simulation` the server derives from, so
 * this module re-derives with the same precedence for that shape. Keep the
 * two derivations in lockstep: attention > channel > scheduled > simulation >
 * manual.
 */

export type ExecutionOrigin = 'attention' | 'channel' | 'scheduled' | 'simulation' | 'manual';

export const EXECUTION_ORIGINS: readonly ExecutionOrigin[] = [
  'attention',
  'channel',
  'scheduled',
  'simulation',
  'manual',
] as const;

/** `input_data.source` values that classify a run as channel-born. */
const CHANNEL_SOURCES = new Set(['channel', 'slack', 'discord', 'team_deliberation']);

function isExecutionOrigin(value: unknown): value is ExecutionOrigin {
  return typeof value === 'string' && (EXECUTION_ORIGINS as readonly string[]).includes(value);
}

/** The `_attention` provenance meta an attention-dispatched run carries. */
export interface AttentionMeta {
  ledgerId: string | null;
  responsibilityId: string | null;
  lane: string | null;
}

/** Minimal row shape both `ExecutionListItem` and `PersonaExecution` satisfy. */
export interface OriginSource {
  origin?: string;
  origin_lane?: string | null;
  input_data?: string | null;
  trigger_id?: string | null;
  is_simulation?: boolean;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Parse the `_attention` block out of a run's raw `input_data`, or `null`
 * when absent/malformed. Malformed JSON is a legal state — `input_data` is
 * caller-supplied and not guaranteed to be JSON.
 */
export function parseAttentionMeta(inputData: string | null | undefined): AttentionMeta | null {
  if (!inputData) return null;
  try {
    // Invariant: `parsed` is caller-supplied JSON — every read below is
    // narrowed through `str()` before use, so no field shape is trusted.
    const parsed = JSON.parse(inputData) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const attention = parsed['_attention'];
    if (typeof attention !== 'object' || attention === null) return null;
    const meta = attention as Record<string, unknown>;
    return {
      ledgerId: str(meta['ledgerId']),
      responsibilityId: str(meta['responsibilityId']),
      lane: str(meta['lane']),
    };
  } catch {
    return null;
  }
}

/**
 * Derive a row's origin + attention lane. Server-derived fields win when
 * present (list rows); otherwise the raw fields are classified with the same
 * precedence the SQL uses (hydrated detail rows).
 */
export function deriveExecutionOrigin(row: OriginSource): {
  origin: ExecutionOrigin;
  lane: string | null;
} {
  if (isExecutionOrigin(row.origin)) {
    return { origin: row.origin, lane: row.origin_lane ?? null };
  }

  let source: string | null = null;
  let attention: AttentionMeta | null = null;
  if (row.input_data) {
    attention = parseAttentionMeta(row.input_data);
    try {
      // Invariant: only the `source` string is read, and it is re-narrowed
      // through `str()` — a non-object or non-string parse degrades to null.
      const parsed = JSON.parse(row.input_data) as Record<string, unknown>;
      if (typeof parsed === 'object' && parsed !== null) source = str(parsed['source']);
    } catch {
      source = null;
    }
  }

  if (source === 'attention' || attention !== null) {
    return { origin: 'attention', lane: attention?.lane ?? null };
  }
  if (source !== null && CHANNEL_SOURCES.has(source)) {
    return { origin: 'channel', lane: null };
  }
  if (row.trigger_id) {
    return { origin: 'scheduled', lane: null };
  }
  if (row.is_simulation) {
    return { origin: 'simulation', lane: null };
  }
  return { origin: 'manual', lane: null };
}
