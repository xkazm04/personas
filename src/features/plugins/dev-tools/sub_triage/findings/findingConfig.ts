// Every threshold the findings sweep uses, in ONE place (docs/plans/dev-findings-loop.md
// §3 2B). Emission is the noisiest thing a sensor can do — when triage starts
// feeling like spam, this is the file to turn down, and nothing else should hide
// a magic number.
//
// The values are deliberately dumb (absolute thresholds, not learned baselines).
// Regression/anomaly detection is a later evolution; the point of Phase 2 is a
// working spine, not a clever detector.

/** A use case whose spend in the window exceeds this is worth a look. */
export const LLM_COST_THRESHOLD_USD = 5;

/** Fraction of calls with NO use-case label above which we ask for instrumentation. */
export const UNNAMED_CALL_SHARE = 0.3;

/** Minimum calls in the window before the unnamed-share finding is meaningful. */
export const UNNAMED_MIN_CALLS = 20;

/** A Sentry issue seen more times than this in the window is worth a look. */
export const SENTRY_COUNT_THRESHOLD = 25;

/** At most this many Sentry findings per sweep — the loudest issues only. */
export const SENTRY_TOP_N = 3;

/** Improve-plan tiers we auto-raise: 0 config · 1 scan · 2 connector. Tier 3
 *  (a full Claude deploy) stays a human decision on the passport. */
export const PASSPORT_MAX_TIER = 2;

/** At most this many dormant-skill findings per sweep — the oldest-unused
 *  first; a fleet-wide skill cleanup should be one deliberate pass, not spam. */
export const SKILL_DORMANT_TOP_N = 3;

/** At most this many doc-rot findings per sweep, harm-ranked (dirty reads
 *  first, then staleness age) — docs rot broadly; the sweep raises the ones
 *  that are actually hurting. */
export const DOC_ROT_TOP_N = 3;

/** Hard cap on new findings per sweep. Anything beyond is dropped and REPORTED —
 *  a silent truncation would read as "nothing else to do". */
export const SWEEP_CAP = 10;
