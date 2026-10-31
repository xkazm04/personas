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
  // `incomplete` added 2026-08-15. This is the state `sweep_zombie_executions`
  // writes when a run is abandoned by a dead process — 20 live rows, all with
  // no output, no duration and no tokens. Because it was missing here, the user
  // could not select or bulk-rerun a lost execution at all
  // (the bulk-rerun "select all failed" filter), which is the one class of run most worth rerunning.
  //
  // The docstring above says this helper exists so a new terminal status only
  // needs adding in one place. It was right, and the status was added to the
  // backend without coming here — which is the failure the centralisation was
  // meant to prevent.
  //
  // `timeout` is kept although the `persona_executions` CHECK constraint does
  // not permit it: harmless, and removing it is a separate question from this
  // fix.
  return (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timeout' ||
    status === 'incomplete'
  );
}

export function isSuccessExecutionStatus(status: string): boolean {
  return status === 'completed';
}

/**
 * A run still in flight: `queued` or `running`, the two non-terminal statuses
 * the `persona_executions` CHECK constraint allows. Call sites used to test
 * `running || pending` - `pending` is not a status that table can hold, and
 * `queued`, which it can, fell through to the terminal branch.
 */
export function isInFlightExecutionStatus(status: string): boolean {
  return status === 'queued' || status === 'running';
}

/** The ledger's status filter: `running` means in flight, `all` means all. */
export function matchesStatusFilter(status: string, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return isInFlightExecutionStatus(status);
  return status === filter;
}
