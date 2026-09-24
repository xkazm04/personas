/**
 * Background runs lane policy for the execution mini player.
 *
 * A run started while another is focused becomes a background run: tracked by
 * status only, no terminal output (executionSlice `executePersona`). This module
 * decides what the lane may do with one and how long it stays on screen. The
 * rules are pure so the store, the status listener and the lane read the same
 * answer.
 */
import type { BackgroundExecution } from '@/stores/slices/agents/executionSlice';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';

/** How long a completed or cancelled lane stays before it fades. */
export const BACKGROUND_FADE_MS = 10_000;

type LaneRun = Pick<BackgroundExecution, 'status'> & Partial<Pick<BackgroundExecution, 'terminalAt'>>;

export interface BackgroundLaneActions {
  stop: boolean;
  open: boolean;
  dismiss: boolean;
}

/** True while the run can still be stopped. */
export function isLiveBackgroundRun(run: Pick<BackgroundExecution, 'status'>): boolean {
  return run.status === 'running' || run.status === 'queued';
}

/**
 * What a lane offers. A live run can be stopped; any run can be opened in the
 * executions list; only a terminal run can be dismissed, so a click cannot hide
 * a run that is still spending.
 */
export function backgroundLaneActions(run: Pick<BackgroundExecution, 'status'>): BackgroundLaneActions {
  const live = isLiveBackgroundRun(run);
  return { stop: live, open: true, dismiss: !live };
}

/**
 * Whether a terminal lane has outlived its window. A failure never fades: it
 * waits for Dismiss, so the player does not forget what the bell remembers.
 */
export function shouldAutoFade(run: LaneRun, now: number): boolean {
  if (run.status !== 'completed' && run.status !== 'cancelled') return false;
  if (!run.terminalAt) return false;
  const endedAt = Date.parse(run.terminalAt);
  if (Number.isNaN(endedAt)) return false;
  return now - endedAt >= BACKGROUND_FADE_MS;
}

/** Counts for the lane summary chip. Queued runs count as running. */
export function backgroundSummary(runs: readonly LaneRun[]): { running: number; failed: number } {
  let running = 0;
  let failed = 0;
  for (const run of runs) {
    if (isLiveBackgroundRun(run)) running += 1;
    else if (run.status === 'failed') failed += 1;
  }
  return { running, failed };
}

/**
 * Open a background run in the Overview executions list. Same hand-off the
 * notification centre and Quick Answer use: `GlobalExecutionList` watches
 * `pendingExecutionFocus` and pops that run's detail modal.
 */
export function openBackgroundRun(executionId: string): void {
  const overview = useOverviewStore.getState();
  overview.setPendingExecutionFocus(executionId);
  overview.setOverviewTab('executions');
  useSystemStore.getState().setSidebarSection('overview');
}
