// ---------------------------------------------------------------------------
// Shared color maps and styling helpers for idea scanner / triage / evolution
// ---------------------------------------------------------------------------

/** Tailwind class bundle for category-based styling */
export interface CategoryTw {
  bg: string;
  text: string;
  dot: string;
  border: string;
}

/** Default Tailwind classes when a category key is unknown */
export const DEFAULT_CATEGORY_TW: CategoryTw = {
  bg: 'bg-status-info/15',
  text: 'text-status-info',
  dot: 'bg-status-info',
  border: 'border-status-info/25',
};

/** Per-category Tailwind class bundles */
export const CATEGORY_TW: Record<string, CategoryTw> = {
  technical: { bg: 'bg-status-info/15', text: 'text-status-info', dot: 'bg-status-info', border: 'border-status-info/25' },
  user: { bg: 'bg-role-human/15', text: 'text-role-human', dot: 'bg-role-human', border: 'border-role-human/25' },
  business: { bg: 'bg-status-warning/15', text: 'text-status-warning', dot: 'bg-status-warning', border: 'border-status-warning/25' },
  mastermind: { bg: 'bg-role-agent/15', text: 'text-role-agent', dot: 'bg-role-agent', border: 'border-role-agent/25' },
};

// ---------------------------------------------------------------------------
// Threshold-based color helpers
// ---------------------------------------------------------------------------

/** Returns combined bg/text/border classes based on a 1-10 level value */
export function levelColor(value: number): string {
  if (value <= 3) return 'bg-status-success/15 text-status-success border-status-success/25';
  if (value <= 6) return 'bg-status-warning/15 text-status-warning border-status-warning/25';
  return 'bg-status-error/15 text-status-error border-status-error/25';
}

/** Non-color severity tier for a 1-10 level value — pairs with levelColor so
 *  severity is readable without relying on hue alone (WCAG 1.4.1). */
export function levelSeverity(value: number): 'low' | 'med' | 'high' {
  if (value <= 3) return 'low';
  if (value <= 6) return 'med';
  return 'high';
}
