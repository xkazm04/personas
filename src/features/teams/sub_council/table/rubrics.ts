// The two rubrics the council judges by, mirrored from the shared skill's
// `skills/council/rubric/*.json` in the ai-registry.
//
// WHY A MIRROR AND NOT A READ: the rubric decides how the rose is DRAWN -
// a wedge's angular width is its member's weight, the ring is the threshold,
// the arc is the floor. A run's verdict rows carry the per-dimension `floor`
// and `kind` that were actually applied, and those always win here; what the
// rows do NOT carry is the weight, the threshold or the coverage floor, and
// the page cannot ask the registry for them (the registry checkout is
// optional and the run may have been ingested from a repo that no longer has
// it). So: weights and thresholds from this constant, floors and kinds from
// the run whenever the run states them.
//
// The unit test beside this file pins each rubric's weights to exactly 1.0,
// so a copy that drifts from the skill fails there rather than silently
// drawing a rose whose wedges no longer close the circle.

/** A member of a rubric: how much it weighs and what it is allowed to sink. */
export interface RubricDimension {
  /** Share of the overall. The wedge's angular width. */
  weight: number;
  /** `null` when the member has no floor of its own. */
  floor: number | null;
  /** 'mechanical' | 'judged' | 'mixed' - a judged floor is advisory while uncalibrated. */
  kind: 'mechanical' | 'judged' | 'mixed';
}

export interface Rubric {
  version: string;
  /** The admitting overall, drawn as the one ring inside the rose. */
  threshold: number;
  /** Below this share of measured weight there is no overall at all. */
  coverageFloor: number;
  /** Insertion order IS seat order: seats 1..n, and the rose's wedge order. */
  dimensions: Record<string, RubricDimension>;
}

export const FEATURE_V1: Rubric = {
  version: 'feature-v1',
  threshold: 0.7,
  coverageFloor: 0.6,
  dimensions: {
    value: { weight: 0.3, floor: 0.4, kind: 'judged' },
    craft: { weight: 0.25, floor: null, kind: 'mixed' },
    rivalry: { weight: 0.2, floor: null, kind: 'judged' },
    robustness: { weight: 0.15, floor: 0.5, kind: 'mechanical' },
    economics: { weight: 0.1, floor: null, kind: 'mechanical' },
  },
};

export const ARCHITECTURE_V1: Rubric = {
  version: 'architecture-v1',
  threshold: 0.7,
  coverageFloor: 0.6,
  dimensions: {
    craft: { weight: 0.35, floor: null, kind: 'mixed' },
    robustness: { weight: 0.3, floor: 0.5, kind: 'mechanical' },
    reversibility: { weight: 0.25, floor: 0.5, kind: 'mechanical' },
    economics: { weight: 0.1, floor: null, kind: 'mechanical' },
  },
};

export const RUBRICS: Record<string, Rubric> = {
  'feature-v1': FEATURE_V1,
  'architecture-v1': ARCHITECTURE_V1,
};

/**
 * The rubric a run was judged by.
 *
 * Total by construction with an explicit unknown arm: a run ingested with a
 * rubric version this build has never heard of falls back to the rubric its
 * subject kind implies rather than returning `undefined` into the drawing
 * code (census `unverifiable-catalog-lookup`). The caller is told which
 * happened through `matched`, so the page can say the rubric is unknown
 * instead of drawing a confident rose over a guess.
 */
export function resolveRubric(
  rubricVersion: string | null | undefined,
  subjectKind: string | null | undefined,
): { rubric: Rubric; matched: boolean } {
  const known = rubricVersion ? RUBRICS[rubricVersion] : undefined;
  if (known) return { rubric: known, matched: true };
  return {
    rubric: subjectKind === 'architecture' ? ARCHITECTURE_V1 : FEATURE_V1,
    matched: false,
  };
}
