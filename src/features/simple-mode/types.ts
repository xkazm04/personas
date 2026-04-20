/**
 * Unified inbox item — the single normalized shape that all three
 * Simple-mode variants (Mosaic, Console, Inbox) render. Adapters in
 * ./hooks/adapters/ translate source-specific store records into this
 * union. Consumers pattern-match on `item.kind` for rendering.
 */

/** Severity bucket used by Simple-mode renderers. Lowered from the richer
 *  backend taxonomy (see `normalizeSeverity`). */
export type Severity = 'critical' | 'warning' | 'info';

/** Discriminant tag for the `UnifiedInboxItem` tagged union.
 *
 *  Note: `'output'` is reserved for Phase 07 (Mosaic variant) and is not
 *  emitted by `useUnifiedInbox` yet. It is included in the union so renderers
 *  can pattern-match exhaustively against a stable shape. */
export type InboxKind = 'approval' | 'message' | 'output' | 'health';

/** Fields common to every inbox item regardless of `kind`. */
interface BaseInboxItem {
  /** Stable id unique across all kinds: `${kind}:${sourceId}` */
  id: string;
  /** Original record id (manualReview.id, message.id, healing.id) */
  source: string;
  personaId: string;
  /** Resolved via agentStore.personas. Falls back to 'Unknown assistant' if persona not found. */
  personaName: string;
  /** Persona icon emoji or lucide key, null if persona missing */
  personaIcon: string | null;
  /** Persona color hex, null if persona missing */
  personaColor: string | null;
  /** ISO-8601 timestamp string (lexicographically sortable). */
  createdAt: string;
  severity: Severity;
  title: string;
  body: string;
}

/** The normalized shape emitted by every adapter. Renderers discriminate on
 *  `kind` and access kind-specific fields via `data`. */
export type UnifiedInboxItem =
  | (BaseInboxItem & {
      kind: 'approval';
      data: {
        executionId: string;
        reviewType: string;
        /** JSON-encoded context blob; renderer is responsible for parsing. */
        contextData: string | null;
        /** JSON-encoded suggested actions; renderer is responsible for parsing. */
        suggestedActions: string | null;
        reviewerNotes: string | null;
        origin: 'local' | 'cloud';
      };
    })
  | (BaseInboxItem & {
      kind: 'message';
      data: {
        executionId: string | null;
        contentType: string;
        priority: string;
        threadId: string | null;
        metadata: string | null;
      };
    })
  | (BaseInboxItem & {
      kind: 'output';
      data: {
        executionId: string;
        /** Sketch shape for Phase 07 to populate. Phase 06 does NOT emit these items. */
        summary: string;
      };
    })
  | (BaseInboxItem & {
      kind: 'health';
      data: {
        executionId: string | null;
        category: string;
        suggestedFix: string | null;
        isCircuitBreaker: boolean;
      };
    });

/**
 * Collapse the variable backend severity vocabulary into the three buckets
 * Simple mode surfaces. Accepts `null`/`undefined` so adapters can pass raw
 * record fields without pre-guarding.
 *
 * Rules (case-insensitive):
 *   - 'critical' | 'error' | 'fatal'   -> 'critical'
 *   - 'warning'  | 'warn'  | 'high'    -> 'warning'
 *   - everything else                   -> 'info'
 */
export function normalizeSeverity(raw: string | null | undefined): Severity {
  const v = (raw ?? 'info').toLowerCase();
  if (v === 'critical' || v === 'error' || v === 'fatal') return 'critical';
  if (v === 'warning' || v === 'warn' || v === 'high') return 'warning';
  return 'info';
}
