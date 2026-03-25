import { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

interface ConnectionStatusBadgeProps {
  connected: boolean;
  isBusy?: boolean;
  connectedLabel?: string;
  disconnectedLabel?: string;
  /** When set, shows a "Reconnecting" state with a countdown to nextRetryAt. */
  reconnecting?: { nextRetryAt: number | null; attempt: number } | null;
}

export function ConnectionStatusBadge({
  connected,
  isBusy = false,
  connectedLabel = 'Connected',
  disconnectedLabel = 'Disconnected',
  reconnecting = null,
}: ConnectionStatusBadgeProps) {
  if (isBusy) {
    return (
      <span className="relative overflow-hidden flex items-center gap-1.5 typo-body px-2 py-0.5 rounded-lg border bg-amber-500/10 border-amber-500/25 text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-300/80 animate-[pulse_1.8s_ease-in-out_infinite] motion-reduce:animate-none" />
        <Wifi className="w-3 h-3 relative z-10 opacity-90" />
        <span className="relative z-10">Connecting...</span>
      </span>
    );
  }

  if (reconnecting) {
    return <ReconnectingBadge nextRetryAt={reconnecting.nextRetryAt} attempt={reconnecting.attempt} />;
  }

  if (connected) {
    return (
      <span className="flex items-center gap-1.5 typo-body px-2 py-0.5 rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
        <Wifi className="w-3 h-3 opacity-90 animate-[pulse_3.2s_ease-in-out_infinite] motion-reduce:animate-none" />
        {connectedLabel}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 typo-body px-2 py-0.5 rounded-lg border bg-red-500/10 border-red-500/20 text-red-400">
      <WifiOff className="w-3 h-3" />
      {disconnectedLabel}
    </span>
  );
}

function ReconnectingBadge({ nextRetryAt, attempt }: { nextRetryAt: number | null; attempt: number }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (nextRetryAt == null) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextRetryAt]);

  return (
    <span
      className="relative overflow-hidden flex items-center gap-1.5 typo-body px-2 py-0.5 rounded-lg border bg-amber-500/10 border-amber-500/25 text-amber-300"
      title={`Reconnection attempt ${attempt + 1} — retrying in ${secondsLeft}s`}
    >
      <WifiOff className="w-3 h-3 opacity-70 animate-[pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none" />
      <span className="relative z-10">
        Reconnecting{secondsLeft > 0 ? ` ${secondsLeft}s` : '...'}
      </span>
    </span>
  );
}
