import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';

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
 * Reads only the (stable) translation proxy for its tooltip labels — no
 * store reads or event subscriptions, so it stays cheap to memoize per row.
 * CONSOLE_DOT / BUSINESS_DOT are exported so the status legend renders the
 * exact same palette + labels.
 */

export type FleetLabelKey = keyof Translations['plugins']['fleet'];

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

export const CONSOLE_DOT: Record<ConsoleAxis, { bg: string; labelKey: FleetLabelKey; pulse?: boolean }> = {
  spawning: { bg: 'bg-cyan-400',    labelKey: 'dot_console_spawning', pulse: true },
  alive:    { bg: 'bg-emerald-500', labelKey: 'dot_console_alive' },
  exited:   { bg: 'bg-zinc-600',    labelKey: 'dot_console_exited' },
};

export const BUSINESS_DOT: Record<BusinessAxis, { bg: string; labelKey: FleetLabelKey; pulse?: boolean } | null> = {
  idle:           { bg: 'bg-emerald-400/70', labelKey: 'dot_biz_idle' },
  working:        { bg: 'bg-blue-400',       labelKey: 'dot_biz_working', pulse: true },
  awaiting_input: { bg: 'bg-violet-400',     labelKey: 'dot_biz_awaiting', pulse: true },
  stale:          { bg: 'bg-orange-400',     labelKey: 'dot_biz_stale' },
  none:           null,
};

interface FleetStatusDotsProps {
  state: FleetSessionState;
  /** Optional state-reason tooltip override (e.g. last hook reason). */
  reason?: string | null;
}

export function FleetStatusDots({ state, reason }: FleetStatusDotsProps) {
  const { t } = useTranslation();
  const { console: con, business: biz } = deriveAxes(state);
  const consoleCfg = CONSOLE_DOT[con];
  const businessCfg = BUSINESS_DOT[biz];
  const consoleLabel = t.plugins.fleet[consoleCfg.labelKey];
  const consoleTitle = reason ? `${consoleLabel} — ${reason}` : consoleLabel;
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={`fleet-dots-${state}`}>
      <Dot bg={consoleCfg.bg} pulse={consoleCfg.pulse} title={consoleTitle} />
      {businessCfg && (
        <Dot bg={businessCfg.bg} pulse={businessCfg.pulse} title={t.plugins.fleet[businessCfg.labelKey]} />
      )}
    </span>
  );
}
