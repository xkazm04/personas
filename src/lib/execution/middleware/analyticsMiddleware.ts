/**
 * Analytics Middleware
 *
 * Captures execution telemetry at the finalize_status stage -- duration,
 * cost, and outcome -- as a structured Sentry event. This fills a gap
 * where navigation analytics existed but execution metrics did not.
 *
 * Stage: finalize_status
 */

import { addMiddleware, type PipelineMiddleware } from '@/lib/execution/pipeline';

const analyticsMiddleware: PipelineMiddleware<'finalize_status'> = (
  _stage,
  payload,
  _trace,
) => {
  const { executionId, status, durationMs, costUsd } = payload;

  import('@sentry/react').then((Sentry) => {
    Sentry.withScope((scope) => {
      scope.setTag('event_type', 'execution_telemetry');
      scope.setTag('execution_status', status);
      scope.setLevel('info');
      scope.setExtras({
        execution_id: executionId,
        duration_ms: durationMs,
        cost_usd: costUsd,
        status,
      });
      Sentry.captureMessage(
        `execution_${status}: ${durationMs ?? '?'}ms, $${costUsd?.toFixed(4) ?? '?'}`,
        'info',
      );
    });
  }).catch(() => {
    // Sentry not initialized -- ignore
  });

  return payload;
};

export function registerAnalyticsMiddleware(): void {
  addMiddleware('finalize_status', analyticsMiddleware);
}
