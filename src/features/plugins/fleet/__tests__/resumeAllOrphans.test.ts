/**
 * After a crash the Sessions badge counted the terminals that survived and
 * stopped there: adopting them meant opening Settings and pressing Resume once
 * per row.
 *
 * The property worth pinning is the ACCOUNTING, not the happy path. An orphan
 * with no `cwd` is counted by `countOrphans` but cannot be resumed at all, so
 * if it were skipped silently "3 orphans" would become "2 resumed" with
 * nothing anywhere explaining the third. And because `mapWithConcurrency` is a
 * worker pool rather than a settle-all, one rejection escaping the per-item
 * catch would abandon every orphan still queued behind it — so a failure in
 * the middle of the list is exercised, not just a failure at the end.
 */
import { describe, it, expect, vi } from 'vitest';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';
import { orphanProcesses, resumeAllOrphans } from '../resumeAllOrphans';
import { countOrphans } from '../useFleetOrphanScan';

function proc(over: Partial<FleetDetectedProcess> & { pid: number }): FleetDetectedProcess {
  return {
    name: 'claude',
    cmd: 'claude',
    cwd: `/repo/${over.pid}`,
    memoryBytes: 0n,
    tracked: false,
    interactive: true,
    ...over,
  } as FleetDetectedProcess;
}

const TABLE: FleetDetectedProcess[] = [
  proc({ pid: 1 }),
  proc({ pid: 2 }),
  proc({ pid: 3 }),
  proc({ pid: 4, tracked: true }),          // Fleet already owns it
  proc({ pid: 5, interactive: false }),     // the app's own `claude -p` call
];

describe('orphanProcesses', () => {
  it('selects exactly what the badge counts', () => {
    expect(orphanProcesses(TABLE).map((p) => p.pid)).toEqual([1, 2, 3]);
    expect(orphanProcesses(TABLE).length).toBe(countOrphans(TABLE));
  });
});

describe('resumeAllOrphans', () => {
  it('adopts every untracked interactive session in one pass', async () => {
    const resumeOrphan = vi.fn().mockResolvedValue(undefined);
    const result = await resumeAllOrphans({
      detectProcesses: async () => TABLE,
      resumeOrphan,
    });

    expect(resumeOrphan).toHaveBeenCalledTimes(3);
    expect(resumeOrphan.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2, 3]);
    expect(result).toEqual({ attempted: 3, resumed: 3, failed: [] });
  });

  it('keeps going past a failure and names the pid that did not make it', async () => {
    const resumeOrphan = vi.fn(async (pid: number) => {
      if (pid === 2) throw new Error('no transcript for that folder');
    });
    const result = await resumeAllOrphans({
      detectProcesses: async () => TABLE,
      resumeOrphan,
    });

    expect(resumeOrphan).toHaveBeenCalledTimes(3);
    expect(result.attempted).toBe(3);
    expect(result.resumed).toBe(2);
    expect(result.failed).toEqual([{ pid: 2, cwd: '/repo/2', reason: 'error' }]);
  });

  it('reports a cwd-less orphan rather than dropping it from the count', async () => {
    const resumeOrphan = vi.fn().mockResolvedValue(undefined);
    const result = await resumeAllOrphans({
      detectProcesses: async () => [proc({ pid: 1 }), proc({ pid: 7, cwd: null })],
      resumeOrphan,
    });

    expect(resumeOrphan).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(2);
    expect(result.resumed).toBe(1);
    expect(result.failed).toEqual([{ pid: 7, cwd: null, reason: 'no-cwd' }]);
  });

  it('re-scans rather than trusting a caller-held list', async () => {
    const detectProcesses = vi.fn().mockResolvedValue([]);
    const result = await resumeAllOrphans({ detectProcesses, resumeOrphan: vi.fn() });

    expect(detectProcesses).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 0, resumed: 0, failed: [] });
  });
});
