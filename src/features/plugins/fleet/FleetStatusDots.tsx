import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

/**
 * Two-axis status indicator: console (process) state + business (Claude) state.
 *
 * The single FleetSessionState enum mixes both. This component splits them
 * into two compact dots so the user can read "is the process alive?" and
 * "what is Claude doing?" independently at a glance — important when scanning
 * a list of 5-10 parallel sessions.
 *
 * Mapping:
 *   spawning       → console: spawning,  business: -
 *   running        → console: alive,     business: working
 *   awaiting_input → console: alive,     business: awaiting_input
 *   idle           → console: alive,     business: idle
 *   stale          → console: alive,     business: stale
 *   exited         → console: exited,    business: -
 *
 * Pure, no store reads, no event subscriptions — safe to memoize as part
 * of a row.
 */

export type ConsoleAxis = 'spawning' | 'alive' | 'exited';
export type BusinessAxis = 'idle' | 'working' | 'awaiting_input' | 'stale' | 'none';

export function deriveAxes(state: FleetSessionState): { console: ConsoleAxis; business: BusinessAxis } {
  switch (state) {
    case 'spawning':       return { console: 'spawning', business: 'none' };
    case 'running':        return { console: 'alive',    business: 'working' };
    case 'awaiting_input': return { console: 'alive',    business: 'awaiting_input' };
    case 'idle':           return { console: 'alive',    business: 'idle' };
    case 'stale':          return { console: 'alive',    business: 'stale' };
    case 'exited':         return { console: 'exited',   business: 'none' };
  }
}

interface DotProps {
  /** Tailwind background colour class for the dot fill. */
  bg: string;
  /** True to apply a pulsing animation. */
  pulse?: boolean;
  /** Tooltip title — describes what the dot means. */
  title: string;
}

function Dot({ bg, pulse, title }: DotProps) {
  return (
    <span title={title} className="relative inline-flex h-2 w-2" aria-label={title}>
      {pulse && (
        <span className={`absolute inset-0 rounded-full opacity-60 animate-ping ${bg}`} />
      )}
      <span className={`relative h-2 w-2 rounded-full ${bg}`} />
    </span>
  );
}

const CONSOLE_DOT: Record<ConsoleAxis, { bg: string; label: string; pulse?: boolean }> = {
  spawning: { bg: 'bg-cyan-400',   label: 'Process spawning', pulse: true },
  alive:    { bg: 'bg-emerald-500', label: 'Process alive' },
  exited:   { bg: 'bg-zinc-600',   label: 'Process exited' },
};

const BUSINESS_DOT: Record<BusinessAxis, { bg: string; label: string; pulse?: boolean } | null> = {
  idle:           { bg: 'bg-emerald-400/70', label: 'Idle — turn finished' },
  working:        { bg: 'bg-blue-400',       label: 'Working — Claude is processing', pulse: true },
  awaiting_input: { bg: 'bg-violet-400',     label: 'Awaiting your input',           pulse: true },
  stale:          { bg: 'bg-orange-400',     label: 'Stale — no activity for 5+ min' },
  none:           null,
};

interface FleetStatusDotsProps {
  state: FleetSessionState;
  /** Optional state-reason tooltip override (e.g. last hook reason). */
  reason?: string | null;
}

export function FleetStatusDots({ state, reason }: FleetStatusDotsProps) {
  const { console: con, business: biz } = deriveAxes(state);
  const consoleCfg = CONSOLE_DOT[con];
  const businessCfg = BUSINESS_DOT[biz];
  const consoleTitle = reason ? `${consoleCfg.label} — ${reason}` : consoleCfg.label;
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={`fleet-dots-${state}`}>
      <Dot bg={consoleCfg.bg} pulse={consoleCfg.pulse} title={consoleTitle} />
      {businessCfg && (
        <Dot bg={businessCfg.bg} pulse={businessCfg.pulse} title={businessCfg.label} />
      )}
    </span>
  );
}
