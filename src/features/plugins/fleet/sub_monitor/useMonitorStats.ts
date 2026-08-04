import { useEffect, useState } from 'react';
import { monitorStats } from '@/api/fleet/monitorStats';
import type { FleetMonitorStats } from '@/lib/bindings/FleetMonitorStats';
import { silentCatch } from '@/lib/silentCatch';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';

/** Transcripts + memory move continuously; a light cadence is plenty for a
 *  ledger the operator scans rather than watches. */
const REFRESH_MS = 10_000;

/**
 * Poll the fleet-wide monitor stats while the Monitor view is mounted.
 *
 * One IPC per tick for the entire fleet, and nothing at all when the view is
 * unmounted or the window is hidden — the monitor must stay free to leave open.
 * Returns a map keyed by internal Fleet session id.
 */
export function useMonitorStats(): Map<string, FleetMonitorStats> {
  const [stats, setStats] = useState<Map<string, FleetMonitorStats>>(new Map());
  const visible = useDocumentVisibility();

  useEffect(() => {
    // Hidden window → keep the last snapshot on screen but stop the polling;
    // the effect re-runs (with an immediate fetch) on return.
    if (!visible) return;
    let cancelled = false;
    const run = () => {
      monitorStats()
        .then((rows) => {
          if (!cancelled) setStats(new Map(rows.map((r) => [r.sessionId, r])));
        })
        .catch(silentCatch('useMonitorStats:monitorStats'));
    };
    run();
    const h = setInterval(run, REFRESH_MS);
    return () => { cancelled = true; clearInterval(h); };
  }, [visible]);

  return stats;
}
