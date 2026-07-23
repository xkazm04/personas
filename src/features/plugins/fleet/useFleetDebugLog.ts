import { useCallback, useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { debugLogStart, debugLogStop, debugLogStatus } from '@/api/fleet/fleet';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * One controller for the DEV fleet debug recorder, shared by every surface
 * that touches it (the grid-header Record button, the always-present footer
 * stop pill).
 *
 * Why a shared hook rather than per-button local state: the recorder lives in
 * Rust and outlives any single mount point, and — critically — the grid
 * overlay header where recording is *started* unmounts the moment you leave
 * grid mode (all sessions exit, or you navigate via the footer section nav).
 * If stop lived only there, an armed recorder would be stranded with no way to
 * turn it off. Routing all of it through the store means the footer can carry a
 * stop control that stays reachable, and both surfaces show one consistent
 * state and one consistent "saved → <path>" toast no matter which stopped it.
 *
 * Pass `poll: true` at exactly one always-mounted call site (the footer) to run
 * the single status poll while a recording is active; other call sites read the
 * same store fields and act through the same start/stop.
 */
export function useFleetDebugLog(opts: { poll?: boolean } = {}) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const apply = useSystemStore((s) => s.fleetApplyDebugLogStatus);
  const active = useSystemStore((s) => s.fleetDebugLogActive);
  const events = useSystemStore((s) => s.fleetDebugLogEvents);
  const path = useSystemStore((s) => s.fleetDebugLogPath);

  const refresh = useCallback(async () => {
    try {
      apply(await debugLogStatus());
    } catch (e) {
      silentCatch('useFleetDebugLog:refresh')(e);
    }
  }, [apply]);

  const start = useCallback(async () => {
    try {
      apply(await debugLogStart());
      addToast(t.plugins.fleet.debug_log_started, 'success');
    } catch (e) {
      toastCatch('useFleetDebugLog:start', 'Failed to start the fleet debug log')(e);
    }
  }, [apply, addToast, t]);

  const stop = useCallback(async () => {
    try {
      const next = await debugLogStop();
      apply(next);
      // 30s: the path is the whole point of the run — a default toast loses it.
      addToast(
        tx(t.plugins.fleet.debug_log_saved, { events: next.events, path: next.path ?? '' }),
        'success',
        30_000,
      );
    } catch (e) {
      toastCatch('useFleetDebugLog:stop', 'Failed to stop the fleet debug log')(e);
    }
  }, [apply, addToast, t, tx]);

  // Adopt whatever the backend is already doing (survives a frontend reload /
  // an overlay remount). Cheap and idempotent, so every mount can do it.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The single poll — only the `poll: true` owner runs it, and only while a
  // recording is active, so an idle fleet does no background work.
  const shouldPoll = opts.poll === true && active;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!shouldPoll) return;
    timer.current = setInterval(() => void refresh(), 5_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [shouldPoll, refresh]);

  return { active, events, path, start, stop, refresh };
}
