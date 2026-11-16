import { useCallback, useState } from 'react';
import { Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFleetDebugLog } from './useFleetDebugLog';
import Button from '@/features/shared/components/buttons/Button';

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
    <Button variant="danger" size="sm"
      type="button"
      data-testid="footer-debug-log-stop"
      onClick={onStop}
      disabled={busy}
      tooltip={t.plugins.fleet.debug_log_stop_title}
      aria-label={t.plugins.fleet.debug_log_stop_title}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-status-error opacity-60 animate-ping motion-reduce:animate-none" />
        <span className="relative h-2 w-2 rounded-full bg-status-error" />
      </span>
      <Square className="w-3 h-3" aria-hidden="true" />
      <span className="typo-caption">{t.plugins.fleet.debug_log_stop}</span>
      <span className="typo-caption opacity-70">{events}</span>
    </Button>
  );
}
