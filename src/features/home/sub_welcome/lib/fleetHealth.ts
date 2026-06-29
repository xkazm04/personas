/**
 * Fleet-health heuristics for the Home dashboard's `FleetHealthStrip`.
 *
 * These thresholds drive the success-rate pill and its red "spike" pulse on the
 * home page — directly user-visible health signals — so the policy is captured
 * here as named, reviewable rules rather than as inline magic numbers.
 *
 * DENOMINATOR (read this first): every ratio below — the success rate AND the
 * failure-spike ratio — is computed over TERMINAL executions only, i.e.
 * `completed + failed`. In-flight rows (running/pending) and cancelled/timeout
 * rows are deliberately EXCLUDED from the denominator. The backend's
 * `get_metrics_summary` reports `totalExecutions = COUNT(*)` (all statuses),
 * `successfulExecutions` (status='completed') and `failedExecutions`
 * (status='failed') separately; "completed" === `successfulExecutions`.
 * Counting non-terminal rows in the denominator is wrong both ways: it dilutes
 * a real failure spike below the firing threshold AND paints a calm-but-low
 * green success rate during normal activity (e.g. 5 completed + 5 running would
 * read "50%" instead of the honest "100% of finished runs").
 */

/**
 * Minimum TERMINAL execution count before we'll consider firing the spike
 * indicator.
 *
 * Rationale: the strip looks at a short rolling window, which means a single
 * bad run on a quiet morning would otherwise paint the fleet red. Three is the
 * smallest sample where a "majority failed" verdict has any signal value —
 * below it, the failure rate is dominated by single-run noise.
 */
export const FAILURE_SPIKE_MIN_EXECUTIONS = 3;

/**
 * Failure ratio (`failed / (completed + failed)`) above which the spike
 * indicator fires.
 *
 * Rationale: at >50% the fleet is failing more than succeeding among FINISHED
 * runs, which is the threshold where the issue is almost certainly *systemic*
 * (bad credential, broken connector, wrong model id) rather than a one-off
 * flake. Below that we treat the noise as expected and leave the pill green so
 * users don't desensitize to the red state.
 */
export const FAILURE_SPIKE_RATIO_THRESHOLD = 0.5;

/**
 * Success rate over TERMINAL executions only, as an integer percentage (0-100),
 * or `null` when there are no terminal executions yet.
 *
 * Denominator = `completed + failed` (see the module note above). A `null`
 * result means "no finished runs to judge" — callers should render a neutral
 * no-data affordance ("—"), NOT a misleading confident "0%" or "100%" for a
 * fleet whose runs are all still in flight.
 */
export function fleetSuccessRatePct(
  completedExecutions: number,
  failedExecutions: number,
): number | null {
  const terminal = completedExecutions + failedExecutions;
  if (terminal === 0) return null;
  return Math.round((completedExecutions / terminal) * 100);
}

/**
 * Decide whether the fleet's recent activity should fire the "failure spike"
 * pulse on the success-rate pill.
 *
 * A spike requires BOTH a non-trivial TERMINAL sample size
 * (`completed + failed >= FAILURE_SPIKE_MIN_EXECUTIONS`, to avoid noise from a
 * single bad run) AND a clear majority-failed signal among finished runs
 * (`failed / (completed + failed) > FAILURE_SPIKE_RATIO_THRESHOLD`, suggesting
 * a systemic issue rather than a one-off). Both conditions must hold — neither
 * alone is informative enough to flag. In-flight runs never count toward either
 * the sample size or the ratio (see the module note above).
 *
 * Boundary behavior (all on the terminal denominator):
 * - `completed+failed < 3`            → false (sample too small, regardless of ratio).
 * - `completed=1, failed=2`           → true  (ratio 0.66 > 0.5).
 * - `completed=3, failed=3`           → false (ratio exactly 0.5; the threshold is *strict* >).
 * - `completed=0, failed=0`           → false (no terminal runs, no signal — even with N running).
 */
export function hasFailureSpike(
  completedExecutions: number,
  failedExecutions: number,
): boolean {
  const terminal = completedExecutions + failedExecutions;
  if (terminal < FAILURE_SPIKE_MIN_EXECUTIONS) return false;
  return failedExecutions / terminal > FAILURE_SPIKE_RATIO_THRESHOLD;
}
