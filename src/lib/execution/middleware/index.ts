/**
 * Pipeline Middleware Registry
 *
 * Central registration point for all execution pipeline middleware.
 * Call registerAllMiddleware() at app startup. Safe to call multiple
 * times -- each middleware uses a deduplication key so HMR re-calls
 * replace rather than accumulate entries.
 *
 * Execution order within a stage is determined by the `priority` option
 * passed to addMiddleware (lower runs first, insertion-order tiebreak).
 */

import { registerKnowledgeMiddleware } from '@/lib/execution/knowledgeMiddleware';
import { registerBudgetMiddleware } from './budgetMiddleware';
import { registerDriftMiddleware } from './driftMiddleware';
import { registerNotificationMiddleware } from './notificationMiddleware';
import { registerAnalyticsMiddleware } from './analyticsMiddleware';
import { registerAuditMiddleware } from './auditMiddleware';
import { registerTimingMiddleware } from './timingMiddleware';

export function registerAllMiddleware(): void {
  // -- validate stage --
  registerKnowledgeMiddleware();

  // -- create_record + finalize_status stages --
  registerAuditMiddleware();

  // -- finalize_status stage --
  registerAnalyticsMiddleware();

  // -- frontend_complete stage (priority: timing=5, notification=10, budget=20, drift=30) --
  registerTimingMiddleware();
  registerNotificationMiddleware();
  registerBudgetMiddleware();
  registerDriftMiddleware();
}
