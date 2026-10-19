/**
 * A run that ended without succeeding and that nobody chose to stop: `failed`, or
 * `incomplete` - the state `sweep_zombie_executions` writes when the run's process died.
 * `cancelled` is a user decision, not a failure, so it stays out (the decided set of
 * `terminal-state-and-recovery.md`).
 *
 * This is the ONE answer the three Home readers of the run sample share - the since-you-left
 * briefing (`sinceLeftBriefing.ts`), the Morning briefing's delta (`sessionDelta.ts`) and the
 * resume pointer (`useResumeContext.ts`). Each used to test `status === 'failed'`, so a run
 * whose process died was counted as a run that went fine and never reached the resume pointer.
 */
export function isLostRun(status: string): boolean {
  return status === 'failed' || status === 'incomplete';
}
