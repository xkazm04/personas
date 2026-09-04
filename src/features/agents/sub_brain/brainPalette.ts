import { useIsDarkTheme } from '@/stores/themeStore';

/**
 * The Brain dashboard's chart palette — **computed, not eyeballed**.
 *
 * Every value below was run through the `dataviz` skill's
 * `scripts/validate_palette.js` against this surface (`bg-secondary/20` over
 * the app background: `#101520` dark, `#eaecf1` light) and only kept once all
 * checks passed:
 *
 * - categorical, dark  `#3b82f6,#059669,#8b5cf6,#d97706` — lightness band,
 *   chroma floor, adjacent CVD ΔE 22.7 (worst pair), normal-vision ΔE 24.0,
 *   contrast ≥ 3:1 — ALL PASS.
 * - categorical, light `#2563eb,#059669,#7c3aed,#b45309` — worst adjacent CVD
 *   ΔE 24.9, normal ΔE 27.2, contrast ≥ 3:1 — ALL PASS.
 * - ordinal (memory tiers), dark `#1d4ed8,#3b82f6,#60a5fa,#93c5fd` and light
 *   `#1e3a8a,#1d4ed8,#3b82f6,#60a5fa` — monotone L, every adjacent ΔL ≥ 0.06,
 *   light-end contrast 2.72:1 / 2.15:1, single hue — ALL PASS.
 *
 * Two facts drove the shapes: the slot ORDER is load-bearing (emerald↔amber is
 * the one weak pair in this hue set — ΔE 7.9 — so violet sits between them and
 * the pair is never adjacent), and dark mode is a **selected** ramp from the
 * same hues rather than an automatic flip (the dark lightness band is
 * 0.48–0.67, which emerald-500 and amber-500 both overshoot).
 *
 * Color follows the ENTITY, never its rank: slot 0 is always the first series
 * of its chart, so filtering or a missing series never repaints the survivors.
 */

/** Categorical slots, in fixed order. Never cycled, never generated. */
const CATEGORICAL_DARK = ['#3b82f6', '#059669', '#8b5cf6', '#d97706'] as const;
const CATEGORICAL_LIGHT = ['#2563eb', '#059669', '#7c3aed', '#b45309'] as const;

/** Ordinal ramp for the memory tiers (core → archived), darkest → lightest. */
const ORDINAL_DARK = ['#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd'] as const;
const ORDINAL_LIGHT = ['#1e3a8a', '#1d4ed8', '#3b82f6', '#60a5fa'] as const;

export interface BrainPalette {
  /** Identity slots — assign by entity, in declaration order. */
  categorical: readonly string[];
  /** Ordered magnitude steps — one hue, more-important-is-darker. */
  ordinal: readonly string[];
}

/**
 * The palette for the active theme. Recharts needs concrete values, so the
 * mode is selected here rather than left to CSS.
 */
export function useBrainPalette(): BrainPalette {
  const isDark = useIsDarkTheme();
  return isDark
    ? { categorical: CATEGORICAL_DARK, ordinal: ORDINAL_DARK }
    : { categorical: CATEGORICAL_LIGHT, ordinal: ORDINAL_LIGHT };
}
