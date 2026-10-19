/**
 * Fleet success rate for the default Cockpit's vitals tile (`defaultCockpit.ts`).
 *
 * The failure-spike half of this module (`hasFailureSpike` and its two thresholds) went with the
 * retired FleetHealthStrip: it had no production caller left and was deleted 2026-10-19.
 *
 * DENOMINATOR (read this first): the success rate is computed over TERMINAL executions only, i.e.
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
