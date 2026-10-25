// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveInPool, summarizeBulkOutcome, BULK_RESOLVE_CONCURRENCY } from '../bulkResolve';
import { isDecisionConflict } from '@/lib/decisions/rowWrites';

function instrumented(failOn: ReadonlySet<number> = new Set()) {
  let inFlight = 0;
  let peak = 0;
  const written: number[] = [];
  const write = async (n: number) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    if (failOn.has(n)) throw new Error(`row ${n} lost the compare-and-swap`);
    written.push(n);
  };
  return { write, written, peak: () => peak };
}

describe('resolveInPool', () => {
  it('caps in-flight writes at the pool width for a 200-row verdict', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => i);
    const probe = instrumented();
    const out = await resolveInPool(rows, probe.write);
    expect(probe.peak()).toBe(BULK_RESOLVE_CONCURRENCY);
    expect(out).toHaveLength(200);
    expect(probe.written.sort((a, b) => a - b)).toEqual(rows);
  });

  it('records a failure with its reason in its own slot and keeps the other lanes going', async () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const probe = instrumented(new Set([2, 7]));
    const out = await resolveInPool(rows, probe.write, 3);
    expect(out).toHaveLength(rows.length);
    expect(out.map((o) => o.status)).toEqual(
      rows.map((n) => (n === 2 || n === 7 ? 'failed' : 'ok')),
    );
    const failed = out[2];
    expect(failed?.status === 'failed' && String((failed.reason as Error).message)).toContain('row 2');
    expect(probe.written).toHaveLength(8);
  });

  it('returns an empty list for an empty batch', async () => {
    expect(await resolveInPool([], async () => undefined)).toEqual([]);
  });
});

describe('summarizeBulkOutcome', () => {
  it('a lost compare-and-swap is decided elsewhere, not still pending', () => {
    const out = summarizeBulkOutcome(
      [
        { status: 'ok' },
        // The IPC door rejects with an AppError object; the phrase is the
        // backend's own (manual_reviews.rs update_status).
        { status: 'failed', reason: { error: 'Manual review r2 was already resolved by a concurrent action', kind: 'Validation' } },
        { status: 'failed', reason: { error: 'database is locked', kind: 'Database' } },
      ],
      isDecisionConflict,
    );
    expect(out).toEqual({ failed: 1, decidedElsewhere: 1 });
  });
});
