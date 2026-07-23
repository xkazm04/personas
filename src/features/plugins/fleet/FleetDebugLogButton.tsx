import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDot, Square } from 'lucide-react';
import type { FleetDebugLogStatus } from '@/lib/bindings/FleetDebugLogStatus';
import { debugLogStart, debugLogStop, debugLogStatus } from '@/api/fleet/fleet';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

/** How often the live counter refreshes while recording. */
const POLL_MS = 5_000;

/**
 * Arm/disarm the fleet debug recorder from the grid header (DEV builds only).
 *
 * Placed next to **New session** on purpose: the grid is where you're standing
 * when a fleet misbehaves, so arming the recorder has to be one click away from
 * the thing you're watching — not buried in Settings.
 *
 * While armed it shows a pulsing red dot plus the live event count, because the
 * failure mode of a recorder like this is forgetting it's on. On stop the file
 * path goes into a long-lived toast (that's the artifact you hand over).
 */
export function FleetDebugLogButton() {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [status, setStatus] = useState<FleetDebugLogStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const active = status?.active === true;

  // Adopt whatever the backend is already doing. The recorder lives in Rust and
  // survives this component (and the whole overlay) unmounting, so the button
  // must reflect the process, not its own memory of it.
  useEffect(() => {
    debugLogStatus().then(setStatus).catch(silentCatch('FleetDebugLogButton:status'));
  }, []);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!active) return;
    timer.current = setInterval(() => {
      debugLogStatus().then(setStatus).catch(silentCatch('FleetDebugLogButton:poll'));
    }, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [active]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (active) {
        const next = await debugLogStop();
        setStatus(next);
        // 30s: the path is the whole point of the run — a 4s toast would lose it.
        addToast(
          tx(t.plugins.fleet.debug_log_saved, { events: next.events, path: next.path ?? '' }),
          'success',
          30_000,
        );
      } else {
        setStatus(await debugLogStart());
        addToast(t.plugins.fleet.debug_log_started, 'success');
      }
    } catch (e) {
      toastCatch('FleetDebugLogButton:toggle', 'Failed to toggle the fleet debug log')(e);
    } finally {
      setBusy(false);
    }
  }, [active, busy, addToast, t, tx]);

  const label = active ? t.plugins.fleet.debug_log_stop : t.plugins.fleet.debug_log_start;

  return (
    <button
      type="button"
      data-testid="fleet-debug-log-toggle"
      onClick={toggle}
      disabled={busy}
      aria-pressed={active}
      title={active ? (status?.path ?? label) : t.plugins.fleet.debug_log_start_title}
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
          <span className="tabular-nums opacity-70">{status?.events ?? 0}</span>
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
