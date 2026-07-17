/**
 * Shared execution-status classification helpers.
 *
 * Several components in this feature independently re-implemented the same
 * "is this a failed/terminal-bad status" check (`failed | cancelled | timeout`),
 * which drifted out of sync between the bulk-rerun hook, toolbar, list, and
 * report view. Centralize it here so a new terminal status only needs to be
 * added in one place.
 */
export function isFailedExecutionStatus(status: string): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'timeout';
}

export function isSuccessExecutionStatus(status: string): boolean {
  return status === 'completed';
}
