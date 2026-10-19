/**
 * Persona health and trust thresholds the frontend reads.
 *
 * The trust SCORE is computed in Rust (`compute_trust_score` in
 * `src-tauri/db/src/repos/core/personas.rs`); only its display tiers live here.
 * The one value that mirrors a Rust constant, `HEALTH_FAILING_MIN`, is
 * tethered by `__tests__/personaThresholds.parity.test.ts`, which reads the
 * Rust source and fails when the two disagree.
 *
 * History (2026-10-19): this module also carried `COMPLETENESS_*` /
 * `completenessColor` (for a `CompletenessRing.tsx` that no longer exists) and
 * a transcription of the trust formula (`TRUST_WEIGHTS`,
 * `HEALING_PENALTY_PER_FAILURE`, `VOLUME_FULL_CREDIT_RUNS`,
 * `TRUST_SAMPLE_SIZE`). All eight had zero readers anywhere in `src/` and
 * nothing checked them against Rust (scoring-and-thresholds.md D11), so they
 * were removed rather than kept as an unread second copy of the formula.
 */

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
// Trust score tiers  (score computed in Rust, displayed in PersonaOverviewBadges)
// ---------------------------------------------------------------------------

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
 *
 * Colours are the theme's own hue tokens (`--status-neutral`, `--brand-*`)
 * rather than raw Tailwind palette classes, so a light theme and the
 * brightness compensation reach them. The tier scale is a ramp, not a status,
 * which is why the brand hues carry it and only L0 borrows a status token.
 */
export const TRUST_TIERS: readonly TrustTier[] = [
  { min: 0,  label: 'L0', color: 'text-status-neutral', bar: 'bg-status-neutral', bg: 'bg-status-neutral/15' },
  { min: 25, label: 'L1', color: 'text-brand-cyan',     bar: 'bg-brand-cyan',     bg: 'bg-brand-cyan/15' },
  { min: 50, label: 'L2', color: 'text-brand-purple',   bar: 'bg-brand-purple',   bg: 'bg-brand-purple/15' },
  { min: 75, label: 'L3', color: 'text-brand-amber',    bar: 'bg-brand-amber',    bg: 'bg-brand-amber/15' },
  { min: 90, label: 'L4', color: 'text-brand-emerald',  bar: 'bg-brand-emerald',  bg: 'bg-brand-emerald/15' },
] as const;

/** Look up the trust tier for a given score (0–100). */
export function getTrustTier(score: number): TrustTier {
  for (let i = TRUST_TIERS.length - 1; i >= 0; i--) {
    if (score >= TRUST_TIERS[i]!.min) return TRUST_TIERS[i]!;
  }
  return TRUST_TIERS[0]!;
}
