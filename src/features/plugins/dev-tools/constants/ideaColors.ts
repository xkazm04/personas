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

/** Hex → Tailwind class mapping used by scan agents */
export const HEX_COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  '#3B82F6': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' },
  '#EF4444': { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/25' },
  '#8B5CF6': { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/25' },
  '#10B981': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/25' },
  '#F59E0B': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/25' },
  '#EC4899': { bg: 'bg-pink-500/15', text: 'text-pink-400', border: 'border-pink-500/25' },
  '#6366F1': { bg: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-indigo-500/25' },
  '#14B8A6': { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/25' },
  '#F97316': { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/25' },
  '#06B6D4': { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/25' },
};

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

/** Returns a text color class based on fitness score */
export function fitnessColor(fitness: number): string {
  if (fitness > 0.3) return 'text-emerald-400';
  if (fitness > 0) return 'text-amber-400';
  return 'text-red-400';
}

/** Returns a background color class based on fitness score (for progress bars) */
export function fitnessBar(fitness: number): string {
  if (fitness > 0.3) return 'bg-emerald-400';
  if (fitness > 0) return 'bg-amber-400';
  return 'bg-red-400';
}
