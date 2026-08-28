import { useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { detectProcesses } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';

/**
 * Orphans worth flagging: interactive Claude sessions Fleet doesn't track.
 * Excludes the app's own transient `claude -p` companion/build calls (which
 * are untracked but not orphans), so the badge doesn't false-alarm.
 */
export function countOrphans(procs: FleetDetectedProcess[]): number {
  return procs.filter((p) => p.interactive && !p.tracked).length;
}

/**
 * Poll for orphaned Claude processes and keep `fleetOrphanCount` fresh so the
 * Settings-tab badge surfaces a restart's orphaned terminals without the user
 * opening Settings. Scans on mount + every `intervalMs` (default 60s).
 */
export function useFleetOrphanScan(intervalMs = 60_000) {
  const setOrphanCount = useSystemStore((s) => s.fleetSetOrphanCount);
  const visible = useDocumentVisibility();
  /**
   * When the process table was last walked — the memory the effect did not have.
   *
   * `visible` is in the dependency array, so the effect is torn down and rebuilt
   * on EVERY focus change, and a rebuild used to scan synchronously. That made
   * the frequency of the app's priciest poll a function of how often the
   * operator alt-tabs, which is not a rate anybody chose. Surviving the teardown
   * in a ref is what lets a re-show ask "has the budget actually elapsed?"
   * instead of assuming it has.
   */
  const lastScanAt = useRef(0);
  useEffect(() => {
    // OS process-table scans are the priciest fleet poll — skip them entirely
    // while the window is hidden.
    if (!visible) return;
    let cancelled = false;
    const scan = () => {
      lastScanAt.current = Date.now();
      return detectProcesses()
        .then((procs) => {
          if (!cancelled) setOrphanCount(countOrphans(procs));
        })
        .catch(silentCatch('useFleetOrphanScan'));
    };

    // Becoming visible spends the REMAINDER of the budget, not a fresh one: an
    // immediate scan only if a full interval has already passed since the last
    // one, otherwise the scan owed is deferred to when it would have run had the
    // window never been hidden. A hide longer than the interval therefore still
    // resumes at once, and a burst of alt-tabs costs nothing.
    const elapsed = Date.now() - lastScanAt.current;
    const due = Math.max(0, intervalMs - elapsed);

    let interval: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      interval = setInterval(scan, intervalMs);
    };

    let deferred: ReturnType<typeof setTimeout> | null = null;
    if (due === 0) {
      scan();
      startInterval();
    } else {
      deferred = setTimeout(() => {
        deferred = null;
        scan();
        startInterval();
      }, due);
    }

    return () => {
      cancelled = true;
      if (deferred !== null) clearTimeout(deferred);
      if (interval !== null) clearInterval(interval);
    };
  }, [intervalMs, setOrphanCount, visible]);
}
