/**
 * Centralised health, completeness, and trust thresholds for persona scoring.
 *
 * Both the Rust backend (`src-tauri/src/db/repos/core/personas.rs`) and all
 * frontend components should reference these constants so that colour coding,
 * status labels, and scoring logic stay in sync.  When changing a value here,
 * update the matching `PERSONA_THRESHOLDS` block in the Rust repo module.
 */

// ---------------------------------------------------------------------------
// Completeness ring  (CompletenessRing.tsx)
// ---------------------------------------------------------------------------

/** ≥ this % → green ring.  Indicates a well-configured persona. */
export const COMPLETENESS_GREEN_MIN = 80;

/** ≥ this % (and < GREEN) → amber ring.  Persona is usable but incomplete. */
export const COMPLETENESS_AMBER_MIN = 40;

/** Below AMBER → grey ring.  Persona needs significant setup work. */
// (implicit: any value < COMPLETENESS_AMBER_MIN)

export const COMPLETENESS_COLORS = {
  green: '#34d399',
  amber: '#fbbf24',
  grey: '#94a3b8',
} as const;

/** Return the ring colour for a completeness percentage. */
export function completenessColor(percent: number): string {
  if (percent >= COMPLETENESS_GREEN_MIN) return COMPLETENESS_COLORS.green;
  if (percent >= COMPLETENESS_AMBER_MIN) return COMPLETENESS_COLORS.amber;
  return COMPLETENESS_COLORS.grey;
}

// ---------------------------------------------------------------------------
// Health status  (computed in Rust, displayed in PersonaHealthIndicator, etc.)
// ---------------------------------------------------------------------------

/**
 * Failure-ratio thresholds applied to the last N executions.
 *
 * - 0 % failures  → "healthy"
 * - < FAILING_MIN → "degraded"  (some failures, but still mostly working)
 * - ≥ FAILING_MIN → "failing"   (majority of recent runs are failing)
 * - no executions → "dormant"
 */
export const HEALTH_FAILING_MIN = 0.6;

// ---------------------------------------------------------------------------
// Trust score tiers  (computed in Rust, displayed in PersonaOverviewPage)
// ---------------------------------------------------------------------------

/**
 * Trust score is a 0–100 composite:
 *   success_rate × 50  +  cost_discipline × 20  +  healing × 15  +  volume × 15
 *
 * See `compute_trust_score` in `src-tauri/src/db/repos/core/personas.rs`.
 */
export const TRUST_WEIGHTS = {
  successRate: 50,
  costDiscipline: 20,
  healing: 15,
  volume: 15,
} as const;

/** Healing penalty per consecutive failure (0.2 × count, capped at 1.0 total). */
export const HEALING_PENALTY_PER_FAILURE = 0.2;

/** Volume bonus reaches 1.0 at this many executions. */
export const VOLUME_FULL_CREDIT_RUNS = 20;

/** Number of recent terminal executions considered for trust scoring. */
export const TRUST_SAMPLE_SIZE = 50;

export interface TrustTier {
  readonly min: number;
  readonly label: string;
  readonly color: string;
  readonly bar: string;
  readonly bg: string;
}

/**
 * Ordered lowest-first.  Walk from the end to find the matching tier for a score.
 *
 * - L0 (0–24):  brand-new or poorly performing
 * - L1 (25–49): early traction, some runs succeeding
 * - L2 (50–74): solid track record emerging
 * - L3 (75–89): reliable with healthy cost posture
 * - L4 (90–100): battle-tested, high confidence
 */
export const TRUST_TIERS: readonly TrustTier[] = [
  { min: 0,  label: 'L0', color: 'text-zinc-400',    bar: 'bg-zinc-500',    bg: 'bg-zinc-500/15' },
  { min: 25, label: 'L1', color: 'text-sky-400',     bar: 'bg-sky-500',     bg: 'bg-sky-500/15' },
  { min: 50, label: 'L2', color: 'text-violet-400',  bar: 'bg-violet-500',  bg: 'bg-violet-500/15' },
  { min: 75, label: 'L3', color: 'text-amber-400',   bar: 'bg-amber-500',   bg: 'bg-amber-500/15' },
  { min: 90, label: 'L4', color: 'text-emerald-400', bar: 'bg-emerald-500', bg: 'bg-emerald-500/15' },
] as const;

/** Look up the trust tier for a given score (0–100). */
export function getTrustTier(score: number): TrustTier {
  for (let i = TRUST_TIERS.length - 1; i >= 0; i--) {
    if (score >= TRUST_TIERS[i]!.min) return TRUST_TIERS[i]!;
  }
  return TRUST_TIERS[0]!;
}
