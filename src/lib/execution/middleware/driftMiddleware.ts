/**
 * Design Drift Detection Middleware
 *
 * Analyzes execution outcomes against persona design expectations and
 * generates drift events when divergence exceeds thresholds. Moved from
 * inline code in executionSlice.finishExecution to decouple drift
 * detection from the core execution lifecycle.
 *
 * Stage: frontend_complete
 */

import { addMiddleware, type PipelineMiddleware } from '@/lib/execution/pipeline';
import { isActiveState } from '@/lib/execution/executionState';
import { detectDesignDrift, saveDriftEvents } from '@/lib/design/designDrift';
import type { AgentIR } from '@/lib/types/designTypes';
import { createLogger } from '@/lib/log';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

const logger = createLogger("drift-middleware");

const driftDetectionMiddleware: PipelineMiddleware<'frontend_complete'> = async (
  _stage,
  payload,
  _trace,
) => {
  const { executionId, finalStatus, personaId, durationMs, costUsd, errorMessage, recentExecutions } = payload;
  if (!personaId || !executionId || !finalStatus) return payload;

  try {
    const { useAgentStore } = await import('@/stores/agentStore');
    const state = useAgentStore.getState();

    const persona = state.personas.find((p) => p.id === personaId);
    if (!persona) return payload;

    // Count the PRIOR runs' consecutive failures -- `detectDesignDrift` adds
    // this run itself (`recentFailureCount + 1 consecutive`, fires at >= 2).
    // Counting `finalStatus` here as well made 2 failures in a row fire and
    // titled 3 as "4 consecutive". Use the pre-captured snapshot from the
    // payload (captured before state reset in finishExecution) so we don't
    // read stale or wrong-persona data. A row still queued/running (this run's
    // own row, or a concurrent one) has no outcome and does not end a streak;
    // `incomplete` (the process died) is not a success, so it extends one.
    let recentFailureCount = 0;
    for (const e of recentExecutions ?? []) {
      if (isActiveState(e.status)) continue;
      if (e.status === 'failed' || e.status === 'incomplete') recentFailureCount++;
      else break;
    }

    let lastDesignResult: AgentIR | null = null;
    if (persona.last_design_result) {
      try { lastDesignResult = JSON.parse(persona.last_design_result); } catch (err) { silentCatch("lib/execution/middleware/driftMiddleware:catch1")(err); }
    }

    const driftEvents = detectDesignDrift(
      {
        status: finalStatus,
        durationMs: durationMs ?? null,
        // Unknown stays unknown. `?? 0` said "this run was free" about a run
        // nobody priced -- harmless today only because the cost-overrun rule
        // guards on `> 0`, which is the wrong reason for a fact to survive.
        costUsd: costUsd ?? null,
        errorMessage: errorMessage ?? null,
        toolSteps: null,
        executionId,
      },
      {
        personaId,
        personaName: persona.name,
        timeoutMs: persona.timeout_ms,
        maxBudgetUsd: persona.max_budget_usd ?? null,
        lastDesignResult,
        recentFailureCount,
      },
    );

    if (driftEvents.length > 0) {
      const all = [...state.designDriftEvents, ...driftEvents];
      saveDriftEvents(all);
      useAgentStore.setState({ designDriftEvents: all });
    }
  } catch (err) {
    logger.warn('Drift detection failed', { executionId, personaId, error: extractMessage(err) });
  }

  return payload;
};

export function registerDriftMiddleware(): void {
  addMiddleware('frontend_complete', { key: 'drift-detection', priority: 30 }, driftDetectionMiddleware);
}
