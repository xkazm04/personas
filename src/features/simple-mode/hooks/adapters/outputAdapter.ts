/**
 * Pure function: map a PersonaMessage that has been classified as an "output"
 * (via `isMessageOutput`) + resolved persona summary into a UnifiedInboxItem
 * of kind 'output'.
 *
 * Phase 17 Topic B: the execution engine now writes `content_type = 'output'`
 * for auto-emitted execution-completion messages (see
 * `src-tauri/src/engine/runner.rs`). That explicit backend signal short-
 * circuits the keyword heuristic the adapter used in Phase 16. The heuristic
 * is still retained as a fallback for messages from code paths that don't set
 * a specific content_type (e.g. test fixtures, legacy rows, future emitters).
 *
 * Classification lives here alongside the adapter so consumers only need to
 * import one thing. `useUnifiedInbox` calls `isMessageOutput` to split the
 * message stream into two buckets and emits each bucket through its adapter;
 * no message is emitted under both kinds.
 */
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { UnifiedInboxItem } from '../../types';

interface PersonaSummary {
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
}

/**
 * Locked keyword list for the output heuristic fallback.
 *
 * Kept intentionally short and English-only for v1.2 — the heuristic is an
 * approximation for "this message looks like a produced artifact rather than a
 * conversational ping", not a localized categorization. Expansion (localized
 * keyword sets, user-tunable list) is out of scope once the backend
 * `content_type = 'output'` signal (Phase 17) covers the execution-completion
 * path. The heuristic still catches markdown-flavored messages and messages
 * emitted by future code paths that haven't adopted the explicit signal yet.
 */
const OUTPUT_KEYWORDS = ['draft', 'summary', 'report', 'digest', 'brief', 'analysis'] as const;

/**
 * Decide whether a PersonaMessage should render as an `output` inbox item.
 *
 * Rules (first hit wins):
 *   1. **Explicit backend signal (Phase 17):** `content_type === 'output'`.
 *      Emitted by `engine/runner.rs` for auto-generated execution-completion
 *      summaries.
 *   2. **Legacy signal:** `content_type === 'result'`. Covers any message
 *      emitted by the earlier rename of the runner hook or by paths that used
 *      the transitional tag. Kept so pre-Phase-17 rows keep rendering in the
 *      output bucket after migration.
 *   3. **Markdown** — `content_type === 'markdown'` is a strong signal the
 *      persona authored a structured artifact, matching Phase 16 semantics.
 *   4. **Keyword fallback:** title OR first 80 characters of content (case-
 *      insensitive) contains any entry from OUTPUT_KEYWORDS. 80 chars keeps
 *      the scan cheap and matches typical first-line summary patterns.
 *
 * Pure; no store or network access. Exported for unit tests and for
 * `useUnifiedInbox` which calls it twice per message (partition).
 */
export function isMessageOutput(msg: PersonaMessage): boolean {
  // 1. Phase 17 explicit signal — emitted by engine/runner.rs.
  if (msg.content_type === 'output') return true;
  // 2. Legacy / transitional signal — any rows tagged 'result' stay in output.
  if (msg.content_type === 'result') return true;
  // 3. Markdown content_type — Phase 16 compatibility (artifact-shaped).
  if (msg.content_type === 'markdown') return true;
  // 4. Keyword fallback for messages created by code paths that don't set a
  //    specific type (e.g. 'text' content_type from custom emitters).
  const haystack = `${msg.title ?? ''} ${msg.content.slice(0, 80)}`.toLowerCase();
  return OUTPUT_KEYWORDS.some((k) => haystack.includes(k));
}

/**
 * Adapt a PersonaMessage into a UnifiedInboxItem of kind 'output'.
 *
 * Severity is always 'info' — outputs are informational by nature; there is
 * no per-message severity field on PersonaMessage. Callers that want
 * urgency-aware rendering should inspect the underlying message priority via
 * a different adapter branch (`adaptMessage` keeps priority-to-severity
 * mapping for `kind: 'message'`).
 *
 * `data.summary` is populated with the first 200 chars of message content
 * for card-face display; full body is preserved in `body`.
 */
export function adaptOutput(
  msg: PersonaMessage,
  persona: PersonaSummary,
): Extract<UnifiedInboxItem, { kind: 'output' }> {
  return {
    id: `output:${msg.id}`,
    kind: 'output',
    source: msg.id,
    personaId: msg.persona_id,
    personaName: persona.personaName,
    personaIcon: persona.personaIcon,
    personaColor: persona.personaColor,
    createdAt: msg.created_at,
    // Outputs are informational by nature — no backend severity field exists
    // on PersonaMessage and message priority is tangential to "is an artifact".
    severity: 'info',
    title: msg.title ?? `${persona.personaName} produced an output`,
    body: msg.content,
    data: {
      // `execution_id` is nullable on PersonaMessage (free-form messages have
      // no execution attached). UnifiedInboxItem's output branch declares
      // executionId as string, so fall back to empty string rather than
      // propagate null upstream.
      executionId: msg.execution_id ?? '',
      summary: msg.content.slice(0, 200),
    },
  };
}
