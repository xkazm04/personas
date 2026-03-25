/**
 * Budget Middleware
 *
 * Invalidates the budget spend cache after each execution completes,
 * so the next budget check uses fresh data.
 *
 * Stage: frontend_complete
 */

import { addMiddleware, type PipelineMiddleware } from '@/lib/execution/pipeline';

const budgetInvalidationMiddleware: PipelineMiddleware<'frontend_complete'> = (
  _stage,
  payload,
  _trace,
) => {
  if (payload.personaId) {
    // Lazy import to avoid circular dependency with agentStore at module load
    void import('@/stores/agentStore').then(({ useAgentStore }) => {
      useAgentStore.getState().invalidateBudgetCache(payload.personaId);
    });
  }
  return payload;
};

export function registerBudgetMiddleware(): void {
  addMiddleware('frontend_complete', budgetInvalidationMiddleware);
}
