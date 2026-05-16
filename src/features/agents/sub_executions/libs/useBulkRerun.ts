import { useCallback, useRef, useState } from 'react';
import { executePersona, getExecution } from '@/api/agents/executions';
import { createLogger } from '@/lib/log';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';

const logger = createLogger('bulk-rerun');

const MAX_CONCURRENT = 3;

export type BulkRunStatus = 'pending' | 'running' | 'success' | 'failed';

export interface BulkRunItem {
  originalId: string;
  origStatus: string;
  origCost: number;
  origDurationMs: number | null;
  origInputTokens: number;
  origOutputTokens: number;
  status: BulkRunStatus;
  newExecutionId: string | null;
  newStatus: string | null;
  newCost: number | null;
  newDurationMs: number | null;
  newInputTokens: number | null;
  newOutputTokens: number | null;
  error: string | null;
}

export type BulkRunPhase = 'idle' | 'running' | 'completed';

export interface BulkRunCohort {
  total: number;
  finished: number;
  successCount: number;
  failedCount: number;
  regressionCount: number;
  recoveredCount: number;
  meanCostDelta: number;
  meanDurationDeltaMs: number;
  totalCostOriginal: number;
  totalCostNew: number;
}

export interface UseBulkRerun {
  phase: BulkRunPhase;
  items: BulkRunItem[];
  cohort: BulkRunCohort;
  start: (rows: ExecutionListItem[], personaId: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

function emptyCohort(): BulkRunCohort {
  return {
    total: 0,
    finished: 0,
    successCount: 0,
    failedCount: 0,
    regressionCount: 0,
    recoveredCount: 0,
    meanCostDelta: 0,
    meanDurationDeltaMs: 0,
    totalCostOriginal: 0,
    totalCostNew: 0,
  };
}

function isFailedStatus(status: string): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'timeout';
}

function deriveCohort(items: BulkRunItem[]): BulkRunCohort {
  const total = items.length;
  let finished = 0;
  let successCount = 0;
  let failedCount = 0;
  let regressionCount = 0;
  let recoveredCount = 0;
  let totalCostOriginal = 0;
  let totalCostNew = 0;
  let costDeltaSum = 0;
  let costDeltaN = 0;
  let durDeltaSum = 0;
  let durDeltaN = 0;

  for (const it of items) {
    totalCostOriginal += it.origCost;
    if (it.status === 'success' || it.status === 'failed') finished += 1;
    if (it.status === 'success') successCount += 1;
    if (it.status === 'failed') failedCount += 1;

    if (it.newCost !== null) {
      totalCostNew += it.newCost;
      costDeltaSum += it.newCost - it.origCost;
      costDeltaN += 1;
    }
    if (it.newDurationMs !== null && it.origDurationMs !== null) {
      durDeltaSum += it.newDurationMs - it.origDurationMs;
      durDeltaN += 1;
    }
    if (it.newStatus !== null) {
      const wasFail = isFailedStatus(it.origStatus);
      const nowFail = isFailedStatus(it.newStatus);
      if (wasFail && !nowFail) recoveredCount += 1;
      if (!wasFail && nowFail) regressionCount += 1;
    }
  }

  return {
    total,
    finished,
    successCount,
    failedCount,
    regressionCount,
    recoveredCount,
    meanCostDelta: costDeltaN > 0 ? costDeltaSum / costDeltaN : 0,
    meanDurationDeltaMs: durDeltaN > 0 ? durDeltaSum / durDeltaN : 0,
    totalCostOriginal,
    totalCostNew,
  };
}

/**
 * Drives a bulk-rerun cohort: fans out execute_persona calls (capped at
 * MAX_CONCURRENT in flight), polls each result, and aggregates into a
 * cohort summary the UI can render.
 *
 * The hook owns its own state machine so cancellation/reset is local — no
 * Zustand churn while the cohort is in flight.
 */
export function useBulkRerun(): UseBulkRerun {
  const [phase, setPhase] = useState<BulkRunPhase>('idle');
  const [items, setItems] = useState<BulkRunItem[]>([]);
  const [cohort, setCohort] = useState<BulkRunCohort>(emptyCohort);
  const cancelledRef = useRef(false);

  const updateItem = useCallback((originalId: string, patch: Partial<BulkRunItem>) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.originalId === originalId ? { ...it, ...patch } : it));
      setCohort(deriveCohort(next));
      return next;
    });
  }, []);

  const runOne = useCallback(async (row: ExecutionListItem, personaId: string) => {
    if (cancelledRef.current) return;
    updateItem(row.id, { status: 'running' });
    try {
      let inputData: string | undefined;
      try {
        const full = await getExecution(row.id, personaId);
        inputData = full.input_data ?? undefined;
      } catch (err) {
        logger.warn('Failed to hydrate input_data; rerunning with empty input', { id: row.id, err });
      }
      const idempotencyKey = `bulk-rerun-${row.id}-${Date.now()}`;
      const result: PersonaExecution = await executePersona(
        personaId,
        undefined,
        inputData,
        row.use_case_id ?? undefined,
        undefined,
        idempotencyKey,
      );
      const successful = !isFailedStatus(result.status);
      updateItem(row.id, {
        status: successful ? 'success' : 'failed',
        newExecutionId: result.id,
        newStatus: result.status,
        newCost: result.cost_usd,
        newDurationMs: result.duration_ms,
        newInputTokens: result.input_tokens,
        newOutputTokens: result.output_tokens,
        error: result.error_message ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Bulk-rerun item failed', { id: row.id, error: msg });
      updateItem(row.id, { status: 'failed', error: msg });
    }
  }, [updateItem]);

  const start = useCallback(async (rows: ExecutionListItem[], personaId: string) => {
    if (rows.length === 0) return;
    cancelledRef.current = false;
    const initial: BulkRunItem[] = rows.map((r) => ({
      originalId: r.id,
      origStatus: r.status,
      origCost: r.cost_usd,
      origDurationMs: r.duration_ms,
      origInputTokens: r.input_tokens,
      origOutputTokens: r.output_tokens,
      status: 'pending',
      newExecutionId: null,
      newStatus: null,
      newCost: null,
      newDurationMs: null,
      newInputTokens: null,
      newOutputTokens: null,
      error: null,
    }));
    setItems(initial);
    setCohort(deriveCohort(initial));
    setPhase('running');

    const queue = [...rows];
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, queue.length); i += 1) {
      workers.push((async function worker() {
        while (queue.length > 0) {
          if (cancelledRef.current) return;
          const next = queue.shift();
          if (!next) return;
          await runOne(next, personaId);
        }
      })());
    }
    await Promise.all(workers);
    setPhase('completed');
  }, [runOne]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setPhase('completed');
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    setItems([]);
    setCohort(emptyCohort());
    setPhase('idle');
  }, []);

  return { phase, items, cohort, start, cancel, reset };
}
