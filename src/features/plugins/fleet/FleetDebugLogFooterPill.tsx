import { useCallback, useState } from 'react';
import { Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFleetDebugLog } from './useFleetDebugLog';

/**
 * Always-mounted footer control for the DEV fleet debug recorder.
 *
 * Recording is *started* from the grid header, but that header unmounts the
 * moment you leave grid mode — so without this, an armed recorder becomes
 * unstoppable once all sessions exit or you navigate away. Mounting the
 * controller here (the footer is always present, even portaled above the grid)
 * guarantees a reachable stop for as long as a recording is running.
 *
 * It renders nothing until a recording is active, so it's invisible in normal
 * use. This is also the single owner of the status poll (`poll: true`); the
 * grid button reads the same store state without a poll of its own.
 */
export function FleetDebugLogFooterPill() {
  const { t } = useTranslation();
  const { active, events, stop } = useFleetDebugLog({ poll: true });
  const [busy, setBusy] = useState(false);

  const onStop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stop();
    } finally {
      setBusy(false);
    }
  }, [busy, stop]);

  if (!active) return null;

  return (
    <button
      type="button"
      data-testid="footer-debug-log-stop"
      onClick={onStop}
      disabled={busy}
      title={t.plugins.fleet.debug_log_stop_title}
      aria-label={t.plugins.fleet.debug_log_stop_title}
      className="flex items-center gap-1.5 h-7 px-2 rounded-input border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/50"
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-red-400 opacity-60 animate-ping motion-reduce:animate-none" />
        <span className="relative h-2 w-2 rounded-full bg-red-400" />
      </span>
      <Square className="w-3 h-3" aria-hidden="true" />
      <span className="text-[11px] font-medium">{t.plugins.fleet.debug_log_stop}</span>
      <span className="text-[11px] tabular-nums opacity-70">{events}</span>
    </button>
  );
}
