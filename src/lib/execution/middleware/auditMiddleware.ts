/**
 * Audit Middleware
 *
 * Emits structured console logs at key pipeline boundaries for
 * debugging and operational visibility. Replaces ad-hoc console.warn
 * calls scattered across store slices.
 *
 * Stages: create_record, finalize_status
 */

import { addMiddleware, type PipelineMiddleware } from '@/lib/execution/pipeline';

const auditCreateRecord: PipelineMiddleware<'create_record'> = (
  _stage,
  payload,
  _trace,
) => {
  console.info('[pipeline:audit] execution created', {
    executionId: payload.executionId,
    stage: 'create_record',
  });
  return payload;
};

const auditFinalizeStatus: PipelineMiddleware<'finalize_status'> = (
  _stage,
  payload,
  _trace,
) => {
  console.info('[pipeline:audit] execution finalized', {
    executionId: payload.executionId,
    status: payload.status,
    durationMs: payload.durationMs,
    costUsd: payload.costUsd,
    error: payload.error,
    stage: 'finalize_status',
  });
  return payload;
};

export function registerAuditMiddleware(): void {
  addMiddleware('create_record', auditCreateRecord);
  addMiddleware('finalize_status', auditFinalizeStatus);
}
