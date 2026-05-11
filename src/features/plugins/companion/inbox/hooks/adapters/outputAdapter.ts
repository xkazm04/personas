/**
 * Pure function: map a PersonaMessage that has been classified as an "output"
 * (via `isMessageOutput`) + resolved persona summary into a UnifiedInboxItem
 * of kind 'output'.
 *
 * The execution engine writes `content_type = 'output'` for auto-emitted
 * execution-completion messages (see `src-tauri/src/engine/runner.rs`). That
 * explicit backend signal short-circuits the keyword heuristic. The heuristic
 * remains as a fallback for messages from code paths that don't set a specific
 * content_type (e.g. test fixtures, legacy rows, future emitters).
 *
 * Classification lives here alongside the adapter so consumers only need to
 * import one thing.
 */
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { UnifiedInboxItem } from '../../types';
import type { PersonaSummary } from './types';

/**
 * Locked keyword list for the output heuristic fallback. Kept intentionally
 * short and English-only — the heuristic is an approximation for "this looks
 * like a produced artifact rather than a conversational ping", not localized
 * categorization. The explicit backend signal covers the canonical path.
 */
const OUTPUT_KEYWORDS = ['draft', 'summary', 'report', 'digest', 'brief', 'analysis'] as const;

/**
 * Decide whether a PersonaMessage should render as an `output` inbox item.
 *
 * Rules (first hit wins):
 *   1. **Explicit backend signal:** `content_type === 'output'`.
 *      Emitted by `engine/runner.rs` for auto-generated completion summaries.
 *   2. **Legacy signal:** `content_type === 'result'`. Pre-rename rows.
 *   3. **Markdown** — `content_type === 'markdown'` is a strong signal the
 *      persona authored a structured artifact.
 *   4. **Keyword fallback:** title OR first 80 chars of content (case-
 *      insensitive) contains any entry from OUTPUT_KEYWORDS.
 */
export function isMessageOutput(msg: PersonaMessage): boolean {
  if (msg.content_type === 'output') return true;
  if (msg.content_type === 'result') return true;
  if (msg.content_type === 'markdown') return true;
  const haystack = `${msg.title ?? ''} ${msg.content.slice(0, 80)}`.toLowerCase();
  return OUTPUT_KEYWORDS.some((k) => haystack.includes(k));
}

/**
 * Adapt a PersonaMessage into a UnifiedInboxItem of kind 'output'.
 *
 * Severity is always 'info'. `data.summary` is populated with the first 200
 * chars of content for card-face display; full body is preserved in `body`.
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
    severity: 'info',
    title: msg.title ?? `${persona.personaName} produced an output`,
    body: msg.content,
    data: {
      executionId: msg.execution_id ?? '',
      summary: msg.content.slice(0, 200),
    },
  };
}
