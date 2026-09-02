import { useCallback, useRef, useState } from 'react';
import { executePersona, getExecution } from '@/api/agents/executions';
import { createLogger } from '@/lib/log';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import { isFailedExecutionStatus, isSuccessExecutionStatus } from './executionStatus';
import { createLatestWins } from '@/stores/util/latestWins';

const logger = createLogger('bulk-rerun');

const MAX_CONCURRENT = 3;

/** How often a dispatched re-run is re-read while waiting for it to land. */
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** How long a single re-run is waited on before its row is left pending. */
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;

/**
 * A re-run has LANDED when its status is terminal. Anything else ('queued',
 * 'running', ...) means the row's cost/duration/token columns are still the
 * zeroes `execute_persona` returns at enqueue time.
 */
function hasLanded(status: string): boolean {
  return isSuccessExecutionStatus(status) || isFailedExecutionStatus(status);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export interface UseBulkRerunOptions {
  /** Overridable for tests; defaults to DEFAULT_POLL_INTERVAL_MS. */
  pollIntervalMs?: number;
  /** Overridable for tests; defaults to DEFAULT_POLL_TIMEOUT_MS. */
  pollTimeoutMs?: number;
}

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
      const wasFail = isFailedExecutionStatus(it.origStatus);
      const nowFail = isFailedExecutionStatus(it.newStatus);
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
 * MAX_CONCURRENT in flight), WAITS for each dispatched run to land before
 * reading its outcome, and aggregates into a cohort summary the UI can render.
 *
 * The waiting is a bounded poll of `get_execution`, not an event subscription,
 * for two reasons. (1) The `execution-status` event carries status/duration/
 * cost only — not `input_tokens`/`output_tokens` — so the authoritative row has
 * to be read back either way and an event would only be a wake-up for that
 * read. (2) A poll is still correct when an event is missed (a run that lands
 * before a listener attaches, a dropped event), and it keeps the cancel +
 * latest-wins discipline in this one file instead of splitting it across a
 * listener's lifetime.
 *
 * Until a run lands, `newStatus` / `newCost` / `newDurationMs` stay null: the
 * row reads as pending rather than as a $0.00 success, and the cohort
 * aggregates count landed runs only.
 *
 * The hook owns its own state machine so cancellation/reset is local — no
 * Zustand churn while the cohort is in flight.
 */
export function useBulkRerun(options: UseBulkRerunOptions = {}): UseBulkRerun {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const [phase, setPhase] = useState<BulkRunPhase>('idle');
  const [items, setItems] = useState<BulkRunItem[]>([]);
  const [cohort, setCohort] = useState<BulkRunCohort>(emptyCohort);
  const cancelledRef = useRef(false);
  // Only the latest-started batch is allowed to write item results — see
  // createLatestWins() for why. `cancelledRef` only stops the worker loop
  // from picking up NEW items; it does not abort in-flight runOne/
  // executePersona promises from a prior batch. Without a token, a stale
  // completion (keyed by originalId, which can collide across batches
  // re-running the same executions) would land in the new cohort's state.
  const latestWins = useRef(createLatestWins()).current;

  const updateItem = useCallback((token: number, originalId: string, patch: Partial<BulkRunItem>) => {
    if (!latestWins.isCurrent(token)) return; // a newer batch has since started
    setItems((prev) => {
      const next = prev.map((it) => (it.originalId === originalId ? { ...it, ...patch } : it));
      setCohort(deriveCohort(next));
      return next;
    });
  }, [latestWins]);

  /**
   * Re-read a dispatched re-run until it lands. Returns the landed execution,
   * or null when the batch was cancelled/superseded or the run was still going
   * when the wait budget ran out — in which case the row stays pending and is
   * never reported as a zero-cost success.
   */
  const waitForLanding = useCallback(
    async (
      executionId: string,
      personaId: string,
      token: number,
    ): Promise<PersonaExecution | null> => {
      const deadline = Date.now() + pollTimeoutMs;
      for (;;) {
        if (cancelledRef.current || !latestWins.isCurrent(token)) return null;
        try {
          const exec = await getExecution(executionId, personaId);
          if (hasLanded(exec.status)) return exec;
        } catch (err) {
          // A transient read failure is not a failed re-run — the run itself is
          // still going. Retry until the budget runs out.
          logger.warn('Failed to read re-run status; retrying', { id: executionId, err });
        }
        if (Date.now() >= deadline) {
          logger.warn('Re-run did not land within the wait budget; left pending', {
            id: executionId,
          });
          return null;
        }
        await delay(pollIntervalMs);
      }
    },
    [latestWins, pollIntervalMs, pollTimeoutMs],
  );

  const runOne = useCallback(async (row: ExecutionListItem, personaId: string, token: number) => {
    if (cancelledRef.current) return;
    updateItem(token, row.id, { status: 'running' });
    try {
      let inputData: string | undefined;
      try {
        const full = await getExecution(row.id, personaId);
        inputData = full.input_data ?? undefined;
      } catch (err) {
        logger.warn('Failed to hydrate input_data; rerunning with empty input', { id: row.id, err });
      }
      const idempotencyKey = `bulk-rerun-${row.id}-${Date.now()}`;
      const dispatched: PersonaExecution = await executePersona(
        personaId,
        undefined,
        inputData,
        row.use_case_id ?? undefined,
        undefined,
        idempotencyKey,
      );
      // `execute_persona` returns the row as it looked IMMEDIATELY after the
      // enqueue — status 'queued', cost 0, duration null, tokens 0. Recording
      // those as the re-run's outcome is what made every report read
      // "$0.0431 -> $0.0000 · success". Only the id is usable here.
      updateItem(token, row.id, { newExecutionId: dispatched.id });

      const landed = await waitForLanding(dispatched.id, personaId, token);
      if (!landed) return; // cancelled, superseded, or still running — stays pending

      const successful = !isFailedExecutionStatus(landed.status);
      updateItem(token, row.id, {
        status: successful ? 'success' : 'failed',
        newExecutionId: landed.id,
        newStatus: landed.status,
        newCost: landed.cost_usd,
        newDurationMs: landed.duration_ms,
        newInputTokens: landed.input_tokens,
        newOutputTokens: landed.output_tokens,
        error: landed.error_message ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Bulk-rerun item failed', { id: row.id, error: msg });
      updateItem(token, row.id, { status: 'failed', error: msg });
    }
  }, [updateItem, waitForLanding]);

  const start = useCallback(async (rows: ExecutionListItem[], personaId: string) => {
    if (rows.length === 0) return;
    cancelledRef.current = false;
    const token = latestWins.next();
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
          await runOne(next, personaId, token);
        }
      })());
    }
    await Promise.all(workers);
    // A newer batch may have started while this one's workers were still
    // draining — don't stomp its 'running' phase back to 'completed'.
    if (latestWins.isCurrent(token)) setPhase('completed');
  }, [runOne, latestWins]);

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
