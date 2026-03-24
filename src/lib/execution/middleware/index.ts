/**
 * Pipeline Middleware Registry
 *
 * Central registration point for all execution pipeline middleware.
 * Call registerAllMiddleware() once at app startup (replaces the
 * individual registerKnowledgeMiddleware() call).
 *
 * Registration order within each stage determines execution order.
 */

import { registerKnowledgeMiddleware } from '@/lib/execution/knowledgeMiddleware';
import { registerBudgetMiddleware } from './budgetMiddleware';
import { registerDriftMiddleware } from './driftMiddleware';
import { registerNotificationMiddleware } from './notificationMiddleware';
import { registerAnalyticsMiddleware } from './analyticsMiddleware';
import { registerAuditMiddleware } from './auditMiddleware';

let registered = false;

export function registerAllMiddleware(): void {
  if (registered) return;
  registered = true;

  // -- validate stage --
  registerKnowledgeMiddleware();

  // -- create_record + finalize_status stages --
  registerAuditMiddleware();

  // -- finalize_status stage --
  registerAnalyticsMiddleware();

  // -- frontend_complete stage (order: notification -> budget -> drift) --
  registerNotificationMiddleware();
  registerBudgetMiddleware();
  registerDriftMiddleware();
}
