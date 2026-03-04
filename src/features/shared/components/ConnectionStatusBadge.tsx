import { Wifi, WifiOff } from 'lucide-react';

interface ConnectionStatusBadgeProps {
  connected: boolean;
  isBusy?: boolean;
  connectedLabel?: string;
  disconnectedLabel?: string;
}

export function ConnectionStatusBadge({
  connected,
  isBusy = false,
  connectedLabel = 'Connected',
  disconnectedLabel = 'Disconnected',
}: ConnectionStatusBadgeProps) {
  if (isBusy) {
    return (
      <span className="relative overflow-hidden flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-md border bg-amber-500/10 border-amber-500/25 text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-300/80 animate-[pulse_1.8s_ease-in-out_infinite] motion-reduce:animate-none" />
        <Wifi className="w-3 h-3 relative z-10 opacity-90" />
        <span className="relative z-10">Connecting...</span>
      </span>
    );
  }

  if (connected) {
    return (
      <span className="flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-md border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
        <Wifi className="w-3 h-3 opacity-90 animate-[pulse_3.2s_ease-in-out_infinite] motion-reduce:animate-none" />
        {connectedLabel}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-md border bg-red-500/10 border-red-500/20 text-red-400">
      <WifiOff className="w-3 h-3" />
      {disconnectedLabel}
    </span>
  );
}
