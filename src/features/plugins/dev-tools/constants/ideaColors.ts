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
  bg: 'bg-blue-500/15',
  text: 'text-blue-400',
  dot: 'bg-blue-400',
  border: 'border-blue-500/25',
};

/** Per-category Tailwind class bundles */
export const CATEGORY_TW: Record<string, CategoryTw> = {
  technical: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400', border: 'border-blue-500/25' },
  user: { bg: 'bg-pink-500/15', text: 'text-pink-400', dot: 'bg-pink-400', border: 'border-pink-500/25' },
  business: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400', border: 'border-amber-500/25' },
  mastermind: { bg: 'bg-violet-500/15', text: 'text-violet-400', dot: 'bg-violet-400', border: 'border-violet-500/25' },
};

// ---------------------------------------------------------------------------
// Threshold-based color helpers
// ---------------------------------------------------------------------------

/** Returns combined bg/text/border classes based on a 1-10 level value */
export function levelColor(value: number): string {
  if (value <= 3) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
  if (value <= 6) return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  return 'bg-red-500/15 text-red-400 border-red-500/25';
}

/** Non-color severity tier for a 1-10 level value — pairs with levelColor so
 *  severity is readable without relying on hue alone (WCAG 1.4.1). */
export function levelSeverity(value: number): 'low' | 'med' | 'high' {
  if (value <= 3) return 'low';
  if (value <= 6) return 'med';
  return 'high';
}
