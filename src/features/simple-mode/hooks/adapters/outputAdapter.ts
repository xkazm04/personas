/**
 * Pure function: map a PersonaMessage that has been classified as an "output"
 * (via `isMessageOutput`) + resolved persona summary into a UnifiedInboxItem
 * of kind 'output'.
 *
 * Phase 16 Topic B: the backend has no per-execution output API and no
 * 'output' enum on `PersonaMessage.content_type`. Adding either is a schema
 * change. As a frontend-only half-measure, we reclassify existing messages
 * that smell like outputs (markdown content, or whose title / first 80 chars
 * of content contain a locked keyword list) into the `output` kind.
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
 * Locked keyword list for the output heuristic.
 *
 * Kept intentionally short and English-only for v1.2 — the heuristic is an
 * approximation for "this message looks like a produced artifact rather than a
 * conversational ping", not a localized categorization. Expansion (localized
 * keyword sets, user-tunable list) is deferred to the proper backend solution.
 */
const OUTPUT_KEYWORDS = ['draft', 'summary', 'report', 'digest', 'brief', 'analysis'] as const;

/**
 * Decide whether a PersonaMessage should render as an `output` inbox item.
 *
 * Rules (first hit wins):
 *   1. `content_type === 'markdown'` — strong signal the persona authored a
 *      structured artifact (the only non-default content_type observed in the
 *      codebase; 'text' is the implicit default).
 *   2. Title OR first 80 characters of content (case-insensitive) contains
 *      any entry from OUTPUT_KEYWORDS. 80 chars keeps the scan cheap and
 *      matches typical first-line summary patterns.
 *
 * Pure; no store or network access. Exported for unit tests and for
 * `useUnifiedInbox` which calls it twice per message (partition).
 */
export function isMessageOutput(msg: PersonaMessage): boolean {
  if (msg.content_type === 'markdown') return true;
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
