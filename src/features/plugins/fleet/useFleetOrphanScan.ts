import { useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { detectProcesses } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';
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
  useEffect(() => {
    let cancelled = false;
    const scan = () =>
      detectProcesses()
        .then((procs) => {
          if (!cancelled) setOrphanCount(countOrphans(procs));
        })
        .catch(silentCatch('useFleetOrphanScan'));
    scan();
    const t = setInterval(scan, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [intervalMs, setOrphanCount]);
}
