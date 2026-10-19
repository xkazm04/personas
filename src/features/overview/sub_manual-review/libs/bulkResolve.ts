import { mapWithConcurrency } from '@/lib/concurrency';

/**
 * Width of the bulk-resolve pool. Each write is a Tauri invoke into one SQLite
 * file that serialises writers anyway, so a handful of lanes keeps the queue
 * moving without turning a 200-row verdict into a 200-call burst.
 */
export const BULK_RESOLVE_CONCURRENCY = 4;

/** One slot per input, always filled: the reason survives, not just the fact. */
export type BulkOutcome =
  | { status: 'ok' }
  | { status: 'failed'; reason: unknown };

/**
 * Write a frozen batch through a bounded pool over a shared cursor
 * (batch-undo-commit-window / bounded-fanout-commit). A rejection is caught
 * inside the lane and recorded at its input's index, so no lane dies with part
 * of the cursor unclaimed; the result array is as long as the input and
 * index-aligned with it. The index is a within-call transport only - callers
 * resolve the pairing before anything leaves the call.
 */
export function resolveInPool<T>(
  items: readonly T[],
  write: (item: T) => Promise<unknown>,
  limit: number = BULK_RESOLVE_CONCURRENCY,
): Promise<BulkOutcome[]> {
  return mapWithConcurrency(items, limit, async (item): Promise<BulkOutcome> => {
    try {
      await write(item);
      return { status: 'ok' };
    } catch (reason) {
      return { status: 'failed', reason };
    }
  });
}

/**
 * Split a batch's misses into the two facts the reviewer needs told apart.
 *
 * `failed` writes did not land and the row is still pending — say so. A lost
 * compare-and-swap (`isConflict`, normally `isDecisionConflict`) is the
 * opposite: the row IS decided, just not by this reviewer (Athena's Night
 * Shift resolves approvals unattended). Counting it as "still pending" told
 * the reviewer something false about rows that had already left the queue.
 */
export function summarizeBulkOutcome(
  outcomes: readonly BulkOutcome[],
  isConflict: (reason: unknown) => boolean,
): { failed: number; decidedElsewhere: number } {
  let failed = 0;
  let decidedElsewhere = 0;
  for (const o of outcomes) {
    if (o.status !== 'failed') continue;
    if (isConflict(o.reason)) decidedElsewhere += 1;
    else failed += 1;
  }
  return { failed, decidedElsewhere };
}
