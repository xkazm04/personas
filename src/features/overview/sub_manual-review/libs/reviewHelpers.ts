import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

// Canonical, shared across every review surface (Phase 5 convergence).
export { parseSuggestedActions } from '@/lib/reviews/suggestedActions';


export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

export type FilterStatus = 'all' | ManualReviewStatus;
export type SourceFilter = 'all' | 'local' | 'cloud';

export const FILTER_LABELS: Record<FilterStatus, string> = {
  all: 'All',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  resolved: 'Resolved',
};

export const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All Sources',
  local: 'Local',
  cloud: 'Cloud',
};


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
