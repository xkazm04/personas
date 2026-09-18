// Bulk re-adoption of orphaned interactive Claude processes.
//
// `useFleetOrphanScan` keeps `fleetOrphanCount` fresh and `FleetPage` badges
// it, but the badge was display-only: adopting the survivors of a crash meant
// opening Settings and pressing Resume once per row. After a restart that left
// three terminals behind, that is three trips through a diagnostics panel.
//
// Reporting is N-of-M by construction. An orphan with no `cwd` is COUNTED by
// `countOrphans` but cannot be resumed (`resume_orphan` needs a folder to find
// the transcript), so it is reported as a failure rather than quietly dropped -
// otherwise "3 orphans" could become "2 resumed" with nothing accounting for
// the third.

import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { detectProcesses as detectProcessesApi, resumeOrphan as resumeOrphanApi } from '@/api/fleet/fleet';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';

/** Adopting a session spawns a PTY and replays a transcript; three at once is
 *  plenty and keeps a post-crash sweep from stampeding the machine it is
 *  recovering. */
export const RESUME_CONCURRENCY = 3;

export interface ResumeFailure {
  pid: number;
  /** Folder the orphan ran in, or null when it reported none. */
  cwd: string | null;
  /** `no-cwd` = unresumable by construction; `error` = the command rejected. */
  reason: 'no-cwd' | 'error';
}

export interface ResumeAllResult {
  /** Orphans seen in the scan this call made — the M in "N of M". */
  attempted: number;
  resumed: number;
  failed: ResumeFailure[];
}

/** Every interactive process Fleet does not track. Mirrors `countOrphans`'
 *  definition exactly, including the cwd-less ones, so the count the badge
 *  shows and the set this acts on can never disagree. */
export function orphanProcesses(procs: FleetDetectedProcess[]): FleetDetectedProcess[] {
  return procs.filter((p) => p.interactive && !p.tracked);
}

export interface ResumeAllDeps {
  detectProcesses: () => Promise<FleetDetectedProcess[]>;
  resumeOrphan: (pid: number, cwd: string) => Promise<unknown>;
}

/**
 * Re-scan, then adopt every orphan the scan found.
 *
 * The scan is deliberately re-run here rather than taking a caller-held list:
 * PIDs are OS-recycled and the badge's number can be up to a poll interval
 * old, so acting on a stale list could resume a pid that is now something else
 * entirely — the same "resolve against the live collection" rule
 * `FleetProcessScanner.doKill` follows before it kills anything.
 */
export async function resumeAllOrphans(
  deps: ResumeAllDeps = { detectProcesses: detectProcessesApi, resumeOrphan: resumeOrphanApi },
): Promise<ResumeAllResult> {
  const orphans = orphanProcesses(await deps.detectProcesses());
  const failed: ResumeFailure[] = [];
  let resumed = 0;

  await mapWithConcurrency(orphans, RESUME_CONCURRENCY, async (p) => {
    if (!p.cwd) {
      failed.push({ pid: p.pid, cwd: null, reason: 'no-cwd' });
      return;
    }
    try {
      await deps.resumeOrphan(p.pid, p.cwd);
      resumed += 1;
    } catch (err) {
      // Caught per item on purpose: `mapWithConcurrency` is a worker pool, not
      // a settle-all, so letting one rejection escape would abandon the
      // orphans still queued behind it. Collecting the pid is for the toast;
      // the error itself still has to reach a telemetry door, or a systematic
      // resume failure is invisible to everyone but the one operator who read
      // the toast.
      silentCatch('features/plugins/fleet/resumeAllOrphans:resume')(err);
      failed.push({ pid: p.pid, cwd: p.cwd, reason: 'error' });
    }
  });

  return { attempted: orphans.length, resumed, failed };
}
