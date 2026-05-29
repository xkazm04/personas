// Versioned, declarative rubric — the thresholds, roll-up divisors, and
// fallback that define a verdict, in ONE place (docs/test/evaluation-rubric.md).
// Previously these magic numbers were inlined across evaluate.mjs + the band
// logic. Bump `version` when any value here changes; the scorecard's
// rubric_version reflects the judged/deterministic mode, not this number.
export const RUBRIC = {
  version: '1',

  // band() thresholds.
  band: {
    productionTeam: 80, // team score floor for PRODUCTION
    productionMinPersona: 60, // weakest-persona-output floor for PRODUCTION
    promisingTeam: 60, // team score floor for PROMISING
    notReadyFloor: 30, // (cosmetic) the rubric has no band below NOT-READY/BROKEN
  },

  // Team-score roll-up divisors: deterministic = 5 dims; judged folds in
  // portfolio balance + judged-output → 7.
  rollup: {
    deterministicDivisor: 5,
    judgedDivisor: 7,
  },

  // Substituted for a dimension that's unavailable for a run (e.g. a doc-track
  // run with no grounding-checkable artifacts, or judge dims not yet scored).
  fallbackScore: 60,
};
