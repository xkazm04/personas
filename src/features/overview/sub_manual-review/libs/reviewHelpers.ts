import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { Translations } from '@/i18n/en';

// Canonical, shared across every review surface (Phase 5 convergence).
export { parseSuggestedActions } from '@/lib/reviews/suggestedActions';


export const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warning',
  // The producer prompt asks personas for info|warning|error|critical and a
  // second writer emits "high"; both used to fall through to 'Info'.
  high: 'High',
  error: 'Error',
  critical: 'Critical',
};

/** A severity label plus whether it was read or defaulted. */
export interface ResolvedReviewSeverity {
  label: string;
  /** True when the payload's severity could not be read and the loud default applied. */
  defaulted: boolean;
}

/**
 * Resolve a review's severity for display. A token this consumer cannot read
 * takes the LOUDEST label and carries a machine-readable `defaulted` marker,
 * instead of being spelled the same way as a readable `info` — otherwise an
 * unreadable payload and a genuinely trivial one become indistinguishable to
 * every downstream surface, including the unattended resolver.
 */
export function resolveReviewSeverity(severity: string | null | undefined): ResolvedReviewSeverity {
  const label = SEVERITY_LABELS[(severity ?? '').trim().toLowerCase()];
  return label ? { label, defaulted: false } : { label: 'Unclassified', defaulted: true };
}

export type FilterStatus = 'all' | ManualReviewStatus;
export type SourceFilter = 'all' | 'local' | 'cloud';

/**
 * The label for a review status (or the "all" filter tab), in the reader's
 * language. Replaces three hardcoded English maps: the filter tabs read
 * "All / Pending / Approved / Rejected" in every one of the 14 locales, and the
 * row pill's map had no `resolved` entry and fell back to 'Pending' -- so every
 * review the stale-review sweep auto-resolved was labelled Pending in the All
 * view. An unrecognised token shows itself rather than borrowing a real one.
 */
export function reviewStatusLabel(t: Translations, status: FilterStatus | string): string {
  const r = t.overview.review;
  switch (status) {
    case 'all': return r.filter_all;
    case 'pending': return r.filter_pending;
    case 'approved': return r.filter_approved;
    case 'rejected': return r.filter_rejected;
    case 'resolved': return t.overview.incidents.filter_status_resolved;
    default: return status;
  }
}

/** The source-filter label (all / local / cloud), in the reader's language. */
export function reviewSourceLabel(t: Translations, source: SourceFilter): string {
  const r = t.overview.review;
  return source === 'local' ? r.source_local : source === 'cloud' ? r.source_cloud : r.source_all;
}


// Personas often prefix review titles with their own name (e.g.
// "Idea Harvest Backlog - Approve Prioritization"). The persona is already
// shown next to the card avatar, so the prefix is redundant noise. Strip
// it when the title actually starts with the persona name followed by a
// common separator. Case-insensitive; tolerates extra whitespace.
const TITLE_SEPARATOR = /^\s*[-–—:|·•]\s*/;

export function stripPersonaPrefix(title: string | null | undefined, personaName?: string | null): string {
  if (!title) return '';
  const t = title.trim();
  if (!personaName) return t;
  const p = personaName.trim();
  if (!p) return t;
  if (t.toLowerCase().startsWith(p.toLowerCase())) {
    const rest = t.slice(p.length);
    const stripped = rest.replace(TITLE_SEPARATOR, '');
    if (stripped && stripped !== t) {
      return stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
  }
  return t;
}

/**
 * A review whose `review_policy` skipped the human queue. Detected from the
 * stable machine markers the backend writes into `reviewer_notes`
 * (engine/dispatch.rs trust_llm + engine/auto_triage.rs) — there is no
 * structured `auto_resolved` column, so these well-known substrings are the
 * signal. Surfacing this closes the "auto-send is a convention, not a visible
 * invariant" gap (UAT P5 — F-NO-CONFIDENCE-AUTORESOLVE).
 */
export interface ReviewAutoResolution {
  /** `trust_llm` = approved on sight by policy; `auto_triage` = second-pass LLM verdict. */
  kind: 'trust_llm' | 'auto_triage';
  /** The machine's reasoning to show (auto_triage only); null for trust_llm. */
  reasoning: string | null;
}

export function detectAutoResolution(
  review: { reviewer_notes: string | null },
): ReviewAutoResolution | null {
  const notes = review.reviewer_notes ?? '';
  if (/\btrust_llm\b/i.test(notes)) return { kind: 'trust_llm', reasoning: null };
  if (/\bauto_triage\b/i.test(notes)) {
    // Note shape (engine/auto_triage.rs): "auto_triage LLM verdict: Approve — <reasoning>".
    const m = notes.match(/verdict:\s*\w+\s*[—–-]+\s*(.+)$/i);
    const reasoning = m?.[1]?.trim();
    return { kind: 'auto_triage', reasoning: reasoning || notes };
  }
  return null;
}

/**
 * Which body the review queue should paint. A failed layered fetch used to
 * fall through to the `length === 0` branch and render the "all caught up"
 * approval hero, so a backend that never answered looked exactly like an
 * empty inbox. Ordered so that: rows always win (a refetch never hides
 * rendered rows), a first load shows the ghost, a failure shows the error,
 * and `empty` stays reserved for a SUCCESSFUL fetch that returned nothing.
 */
export type ReviewQueueView = 'ghost' | 'error' | 'empty' | 'list';

export function resolveReviewQueueView(state: {
  loading: boolean;
  error: string | null;
  visibleCount: number;
}): ReviewQueueView {
  if (state.visibleCount > 0) return 'list';
  if (state.loading) return 'ghost';
  if (state.error) return 'error';
  return 'empty';
}

