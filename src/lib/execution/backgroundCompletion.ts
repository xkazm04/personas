import {
  createPipelineTrace,
  runMiddleware,
  type FinalizeStatusPayload,
  type FrontendCompletePayload,
} from '@/lib/execution/pipeline';
import type { TerminalExecutionState } from '@/lib/execution/executionState';
import { silentCatch } from '@/lib/silentCatch';

export interface BackgroundCompletion {
  executionId: string;
  personaId: string;
  status: TerminalExecutionState;
  error?: string | null;
  durationMs?: number | null;
  costUsd?: number | null;
  /** The persona's latest runs, newest first, snapshotted by the caller. */
  recentExecutions?: Array<{ persona_id: string; status: string }>;
}

/**
 * Run the post-run middleware for a run that finished in the BACKGROUND.
 *
 * The focused run reaches `finalize_status` / `frontend_complete` through
 * finalizeTerminalStatus + finishExecution. A background lane's terminal event
 * only updated its lane, so the budget-cache invalidation, the
 * `execution:completed` storeBus event (quick stats, spend alerts, tour
 * activation), the execution telemetry and drift detection never saw it.
 * Background runs have no live trace, so a fresh one stands in.
 */
export function runBackgroundCompletion(done: BackgroundCompletion): Promise<void> {
  const trace = createPipelineTrace(done.executionId);
  const finalize: FinalizeStatusPayload = {
    executionId: done.executionId,
    status: done.status,
    error: done.error ?? null,
    durationMs: done.durationMs ?? null,
    costUsd: done.costUsd ?? null,
  };
  const complete: FrontendCompletePayload = {
    executionId: done.executionId,
    finalStatus: done.status,
    personaId: done.personaId,
    durationMs: done.durationMs,
    costUsd: done.costUsd,
    errorMessage: done.error,
    recentExecutions: done.recentExecutions ?? [],
  };
  return runMiddleware('finalize_status', finalize, trace)
    .then(() => runMiddleware('frontend_complete', complete, trace))
    .then(() => undefined)
    .catch(silentCatch('lib/execution/backgroundCompletion:runBackgroundCompletion'));
}
