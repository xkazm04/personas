/**
 * Single source of truth for every memory surface's colors.
 *
 * Before this module the palette was scattered: category→hex was copied verbatim
 * into MemoriesPage (`CATEGORY_HEX_COLORS`) and MemoriesPageGraph (`CATEGORY_HEX`),
 * and importance→color was computed three different ways (oklch breakpoints in
 * MemoryCard, inline hex in the dense matrix, a percentage ring in the stats bar).
 * That guaranteed drift — the graph and the list could disagree on what "high
 * importance" looks like, and a palette tweak meant editing five places.
 *
 * Now the list, stats ring, dense matrix, and knowledge graph all consume the two
 * functions here, so the whole memory feature stays chromatically consistent and a
 * future theme change is a one-file edit.
 */
import {
  MEMORY_CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLORS,
  type CategoryColors,
} from '@/lib/utils/formatters';

// -- Category ----------------------------------------------------------------

/**
 * Raw hex per memory category — the Tailwind `-500` hue, for the contexts where a
 * class can't be used (SVG fills, inline `backgroundColor`, graph node colors).
 * Kept in lockstep with `MEMORY_CATEGORY_COLORS`' hues (which supply the class
 * tokens). Edit both together if the category palette ever changes.
 */
const CATEGORY_HEX: Record<string, string> = {
  fact: '#3b82f6', // blue-500
  preference: '#f59e0b', // amber-500
  instruction: '#8b5cf6', // violet-500
  context: '#10b981', // emerald-500
  learned: '#06b6d4', // cyan-500
  constraint: '#ef4444', // red-500
};

const CATEGORY_HEX_FALLBACK = '#6b7280'; // gray-500

export interface CategoryToken extends CategoryColors {
  /** Raw hex (Tailwind `-500`) for non-class contexts: SVG, inline styles, graph. */
  hex: string;
}

/**
 * A memory category's colors — Tailwind `classes` (label/bg/text/border/accent)
 * AND a raw `hex`, from one place. Unknown categories fall back to the shared
 * neutral token (with the raw category string as the label).
 */
export function categoryColor(category: string): CategoryToken {
  const classes = MEMORY_CATEGORY_COLORS[category] ?? { ...DEFAULT_CATEGORY_COLORS, label: category };
  return { ...classes, hex: CATEGORY_HEX[category] ?? CATEGORY_HEX_FALLBACK };
}

// -- Importance --------------------------------------------------------------

/**
 * Importance heat colors (emerald → amber → rose). These are the hex equivalents
 * of the oklch values the cards used previously, so consolidating is a no-op
 * visually while making every surface agree.
 */
export const IMPORTANCE_HEX = {
  low: '#34d399', // emerald-400
  medium: '#fbbf24', // amber-400
  high: '#fb7185', // rose-400
} as const;

/**
 * Importance → color on the 1–5 scale, with ONE threshold set used everywhere:
 *   - `≤ 2` → low (emerald)
 *   - `≤ 3` → medium (amber)
 *   - else  → high (rose)
 *
 * Works for both integer memory importance and the float average shown in the
 * stats ring (e.g. avg 3.4 → high, matching the old percentage breakpoints).
 */
export function importanceColor(value: number): string {
  if (value <= 2) return IMPORTANCE_HEX.low;
  if (value <= 3) return IMPORTANCE_HEX.medium;
  return IMPORTANCE_HEX.high;
}

/** Two-stop gradient for the importance bar fill — same thresholds/colors as
 *  {@link importanceColor}. */
export function importanceGradient(value: number): string {
  const { low, medium, high } = IMPORTANCE_HEX;
  if (value <= 2) return `linear-gradient(90deg, ${low}, ${low})`;
  if (value <= 3) return `linear-gradient(90deg, ${low}, ${medium})`;
  return `linear-gradient(90deg, ${medium}, ${high})`;
}
