/**
 * Event skip-reason ledger — parsing side.
 *
 * When the event bus reaches an event and does NOT start an execution, it
 * records WHY as machine tokens in `persona_events.error_message` (see
 * `src-tauri/src/engine/background.rs` → `EventGateReason`). The same column
 * also carries genuine free-form failure text for `failed` / `dead_letter`
 * rows, so the two uses have to be told apart before rendering.
 *
 * The rule is strict on purpose: a value is a reason ledger ONLY when every
 * comma-separated part is a token we know. Anything else is treated as an
 * error message and rendered verbatim — we never guess at a label for text we
 * did not emit, and we never fabricate a reason for a row that has none.
 */

/** Every token the Rust bus can write. Keep in sync with `EventGateReason::token`. */
export const EVENT_REASON_TOKENS = [
  'no_subscriber',
  'approval_held',
  'persona_disabled',
  'handoff_target_disabled',
  'cross_team_blocked',
  'cascade_guard',
  'dry_run',
  'stuck_reclaimed',
  'stuck_retry_exhausted',
] as const;

export type EventReasonToken = (typeof EVENT_REASON_TOKENS)[number];

const TOKEN_SET: ReadonlySet<string> = new Set(EVENT_REASON_TOKENS);

/**
 * Event statuses for which a MISSING reason is itself worth surfacing: the bus
 * ended the event without delivering, so "why" is a question the user can
 * legitimately ask. Rows written before the ledger existed land here and are
 * shown as unknown rather than silently blank.
 */
const REASON_EXPECTED_STATUSES: ReadonlySet<string> = new Set([
  'skipped',
  'failed',
  'dead_letter',
]);

/**
 * Split a reason column into known tokens.
 *
 * Returns `null` when the value is empty or is NOT a pure token list — the
 * caller should then render the raw text (a real failure message).
 */
export function parseEventReasonTokens(errorMessage: string | null | undefined): string[] | null {
  const raw = errorMessage?.trim();
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.every((p) => TOKEN_SET.has(p)) ? parts : null;
}

/** Whether a NULL/blank reason on this status should read as "unknown". */
export function reasonIsExpectedFor(status: string): boolean {
  return REASON_EXPECTED_STATUSES.has(status);
}

/** What an event's reason column should render as. */
export type EventReasonKind =
  | { kind: 'tokens'; tokens: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'unknown' }
  | { kind: 'none' };

/**
 * Classify one event's reason column. Pure — the label lookup happens in the
 * component so this stays testable without an i18n context.
 */
export function classifyEventReason(event: {
  status: string;
  error_message: string | null;
}): EventReasonKind {
  const tokens = parseEventReasonTokens(event.error_message);
  if (tokens) return { kind: 'tokens', tokens };
  const raw = event.error_message?.trim();
  if (raw) return { kind: 'text', text: raw };
  return reasonIsExpectedFor(event.status) ? { kind: 'unknown' } : { kind: 'none' };
}
