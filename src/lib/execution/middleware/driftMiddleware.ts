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
import { detectDesignDrift, saveDriftEvents } from '@/lib/design/designDrift';
import type { AgentIR } from '@/lib/types/designTypes';
import { createLogger } from '@/lib/log';

const logger = createLogger("drift-middleware");

const driftDetectionMiddleware: PipelineMiddleware<'frontend_complete'> = async (
  _stage,
  payload,
  _trace,
) => {
  const { executionId, finalStatus, personaId, durationMs, costUsd, errorMessage } = payload;
  if (!personaId || !executionId || !finalStatus) return payload;

  try {
    const { useAgentStore } = await import('@/stores/agentStore');
    const state = useAgentStore.getState();

    const persona = state.personas.find((p) => p.id === personaId);
    if (!persona) return payload;

    // Count recent consecutive failures from the current executions list.
    // Prepend the just-finished status for the current execution.
    const recentStatuses: string[] = [finalStatus];
    const existingExecs = state.executions
      .filter((e) => e.persona_id === personaId)
      .slice(0, 4); // 4 + 1 current = 5 total window
    for (const e of existingExecs) {
      recentStatuses.push(e.status);
    }
    let recentFailureCount = 0;
    for (const s of recentStatuses) {
      if (s === 'failed') recentFailureCount++;
      else break;
    }

    let lastDesignResult: AgentIR | null = null;
    if (persona.last_design_result) {
      try { lastDesignResult = JSON.parse(persona.last_design_result); } catch { /* ignore */ }
    }

    const driftEvents = detectDesignDrift(
      {
        status: finalStatus,
        durationMs: durationMs ?? null,
        costUsd: costUsd ?? 0,
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
    logger.warn('Drift detection failed', { executionId, personaId, error: String(err) });
  }

  return payload;
};

export function registerDriftMiddleware(): void {
  addMiddleware('frontend_complete', { key: 'drift-detection', priority: 30 }, driftDetectionMiddleware);
}
