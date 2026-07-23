import { useCallback, useState } from 'react';
import { CircleDot, Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFleetDebugLog } from './useFleetDebugLog';

/**
 * Arm/disarm the fleet debug recorder from the grid header (DEV builds only).
 *
 * Placed next to **New session** on purpose: the grid is where you're standing
 * when a fleet misbehaves, so arming the recorder has to be one click away from
 * the thing you're watching — not buried in Settings.
 *
 * While armed it shows a pulsing red dot plus the live event count, because the
 * failure mode of a recorder like this is forgetting it's on. All state + the
 * start/stop/"saved" behaviour live in `useFleetDebugLog`, so stopping here and
 * stopping from the footer pill are the same operation — this component is just
 * the grid-header face of it.
 */
export function FleetDebugLogButton() {
  const { t } = useTranslation();
  const { active, events, path, start, stop } = useFleetDebugLog();
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await (active ? stop() : start());
    } finally {
      setBusy(false);
    }
  }, [active, busy, start, stop]);

  const label = active ? t.plugins.fleet.debug_log_stop : t.plugins.fleet.debug_log_start;

  return (
    <button
      type="button"
      data-testid="fleet-debug-log-toggle"
      onClick={toggle}
      disabled={busy}
      aria-pressed={active}
      title={active ? (path ?? label) : t.plugins.fleet.debug_log_start_title}
      className={`flex items-center gap-1.5 rounded-interactive border px-2 py-1 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
        active
          ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
          : 'border-primary/15 text-foreground hover:bg-secondary/50'
      }`}
    >
      {active ? (
        <>
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-red-400 opacity-60 animate-ping motion-reduce:animate-none" />
            <span className="relative h-2 w-2 rounded-full bg-red-400" />
          </span>
          <Square className="w-3 h-3" aria-hidden="true" />
          {label}
          <span className="tabular-nums opacity-70">{events}</span>
        </>
      ) : (
        <>
          <CircleDot className="w-3.5 h-3.5" aria-hidden="true" />
          {label}
        </>
      )}
    </button>
  );
}
