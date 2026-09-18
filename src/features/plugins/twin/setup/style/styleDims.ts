/**
 * Pure arithmetic over the 8 style dimensions: range, coherence, identity.
 *
 * The Rust validation door is the authority on what the backend accepts; this
 * module mirrors the same three coherence rules so the client never SENDS a
 * target it knows the door would refuse (channel shifts can push a coherent
 * preset into an incoherent corner, e.g. email raising formality).
 */

import {
  STYLE_DIMENSIONS,
  STYLE_MAX,
  STYLE_MIN,
  type StyleDimension,
  type TwinStyleDims,
} from './styleContract';

/** Most dimensions allowed at an extreme (1 or 5) at once. */
export const MAX_EXTREMES = 3;

export function clampLevel(value: number): number {
  return Math.min(STYLE_MAX, Math.max(STYLE_MIN, Math.round(value)));
}

/** The two contradictory pairs: formal with heavy expressiveness, ceremonial with irreverent. */
export function violatesPairRules(dims: TwinStyleDims): boolean {
  if (dims.formality >= 4 && dims.expressiveness >= 4) return true;
  return dims.humor === 5 && dims.formality === 5;
}

/**
 * The three coherence rules: a formal register does not carry heavy emoji and
 * slang, irreverent humor does not sit in a ceremonial register, and a style
 * pinned at more than three extremes reads as a caricature.
 *
 * NOTE: two curated presets (executive-brief at 5 extremes, close-informal at
 * 4) break the third rule by design; see `CURATED_EXTREME_EXCEPTIONS` in the
 * catalog test. `makeCoherent` therefore takes an extremes budget, so a channel
 * shift never makes a style LESS coherent than its base without flattening a
 * curated preset into something it is not.
 */
export function isCoherent(dims: TwinStyleDims, extremeBudget: number = MAX_EXTREMES): boolean {
  return !violatesPairRules(dims) && extremeCount(dims) <= extremeBudget;
}

export function isExtreme(value: number): boolean {
  return value === STYLE_MIN || value === STYLE_MAX;
}

export function extremeCount(dims: TwinStyleDims): number {
  return STYLE_DIMENSIONS.filter((d) => isExtreme(dims[d])).length;
}

interface CoherenceOptions {
  /** Most extremes tolerated; defaults to the rule's 3. */
  extremeBudget?: number;
  /** Dimensions the caller set absolutely (e.g. voice has no emoji); never moved. */
  locked?: readonly StyleDimension[];
  /**
   * Dimensions that may give way AFTER expressiveness and formality, in order:
   * the ones a channel shift moved, so the fix relaxes the shift itself before
   * it would ever leave the style incoherent.
   */
  fallback?: readonly StyleDimension[];
}

/**
 * Walk an incoherent style back to a coherent one, one step at a time:
 * expressiveness first (the cheapest register to drop), then formality. Each
 * step moves the offending dimension toward the middle, so the loop ends; if
 * none of them can move, the style is returned as far as it got.
 */
export function makeCoherent(input: TwinStyleDims, options: CoherenceOptions = {}): TwinStyleDims {
  const budget = options.extremeBudget ?? MAX_EXTREMES;
  const locked = new Set(options.locked ?? []);
  const dims = { ...input };
  const towardMiddle = (d: StyleDimension) => {
    dims[d] += dims[d] > 3 ? -1 : 1;
  };
  const movable = (d: StyleDimension) =>
    !locked.has(d) && isExtreme(dims[d]);

  for (let guard = 0; guard < 16 && !isCoherent(dims, budget); guard += 1) {
    if (dims.formality >= 4 && dims.expressiveness >= 4) {
      if (!locked.has('expressiveness')) dims.expressiveness -= 1;
      else dims.formality -= 1;
    } else if (dims.humor === 5 && dims.formality === 5) {
      dims.formality -= 1;
    } else if (movable('expressiveness')) {
      towardMiddle('expressiveness');
    } else if (movable('formality')) {
      towardMiddle('formality');
    } else {
      const next = (options.fallback ?? []).find(movable);
      if (!next) break;
      towardMiddle(next);
    }
  }
  return dims;
}

/** Stable identity for a dimension vector, e.g. for dedupe and React keys. */
export function dimsKey(dims: TwinStyleDims): string {
  return STYLE_DIMENSIONS.map((d) => dims[d]).join('');
}
