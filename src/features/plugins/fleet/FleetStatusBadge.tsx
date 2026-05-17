import { Loader2, CheckCircle2, Clock, AlertCircle, Ban, Hourglass } from 'lucide-react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

interface StateConfig {
  label: string;
  icon: typeof Loader2;
  className: string;
  pulse?: boolean;
}

const STATE_CONFIG: Record<FleetSessionState, StateConfig> = {
  spawning: {
    label: 'Spawning',
    icon: Loader2,
    className: 'bg-primary/10 text-foreground border-primary/15',
    pulse: true,
  },
  running: {
    label: 'Running',
    icon: Loader2,
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    pulse: true,
  },
  awaiting_input: {
    label: 'Waiting for you',
    icon: Hourglass,
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    pulse: true,
  },
  idle: {
    label: 'Idle',
    icon: CheckCircle2,
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  },
  stale: {
    label: 'Stale',
    icon: Clock,
    className: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  },
  exited: {
    label: 'Exited',
    icon: Ban,
    className: 'bg-primary/10 text-foreground/60 border-primary/10',
  },
};

export function FleetStatusBadge({ state, reason }: { state: FleetSessionState; reason?: string | null }) {
  const cfg = STATE_CONFIG[state] ?? {
    label: state,
    icon: AlertCircle,
    className: 'bg-red-500/15 text-red-400 border-red-500/25',
  };
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 typo-caption font-medium border ${cfg.className}`}
      title={reason ?? cfg.label}
    >
      <Icon className={`w-3 h-3 ${cfg.pulse ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

/** Sort priority — higher = more attention-grabbing. */
export const STATE_PRIORITY: Record<FleetSessionState, number> = {
  awaiting_input: 5,
  running: 4,
  spawning: 3,
  idle: 2,
  stale: 1,
  exited: 0,
};
