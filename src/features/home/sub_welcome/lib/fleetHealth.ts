/**
 * Fleet-health heuristics for the Home dashboard's `FleetHealthStrip`.
 *
 * These thresholds drive the red "spike" pulse on the home page success-rate
 * pill — a directly user-visible health signal — so the policy is captured
 * here as a named, reviewable rule rather than as inline magic numbers.
 */

/**
 * Minimum execution count before we'll consider firing the spike indicator.
 *
 * Rationale: the strip looks at a short rolling window (today's executions),
 * which means a single bad run on a quiet morning would otherwise paint the
 * fleet red. Three is the smallest sample where a "majority failed" verdict
 * has any signal value — below it, the failure rate is dominated by
 * single-run noise.
 */
export const FAILURE_SPIKE_MIN_EXECUTIONS = 3;

/**
 * Failure ratio (failed/total) above which the spike indicator fires.
 *
 * Rationale: at >50% the fleet is failing more than succeeding, which is the
 * threshold where the issue is almost certainly *systemic* (bad credential,
 * broken connector, wrong model id) rather than a one-off flake. Below that
 * we treat the noise as expected and leave the pill green so users don't
 * desensitize to the red state.
 */
export const FAILURE_SPIKE_RATIO_THRESHOLD = 0.5;

/**
 * Decide whether the fleet's recent activity should fire the "failure spike"
 * pulse on the success-rate pill.
 *
 * A spike requires BOTH a non-trivial sample size (`>= FAILURE_SPIKE_MIN_EXECUTIONS`,
 * to avoid noise from a single bad run) AND a clear majority-failed signal
 * (`failed / total > FAILURE_SPIKE_RATIO_THRESHOLD`, suggesting a systemic
 * issue rather than a one-off). Both conditions must hold — neither alone
 * is informative enough to flag.
 *
 * Boundary behavior:
 * - `total < 3`             → false (sample too small, regardless of ratio).
 * - `total = 3, failed = 2` → true  (ratio 0.66 > 0.5).
 * - `total = 6, failed = 3` → false (ratio exactly 0.5; the threshold is *strict* >).
 * - `total = 0`             → false (no executions, no signal).
 */
export function hasFailureSpike(totalExecutions: number, failedExecutions: number): boolean {
  if (totalExecutions < FAILURE_SPIKE_MIN_EXECUTIONS) return false;
  return failedExecutions / totalExecutions > FAILURE_SPIKE_RATIO_THRESHOLD;
}
