import {
  Ban, CircleCheck, CircleHelp, Clock, Loader2, MoonStar, Sparkles, SquareCheckBig,
  Cpu, Bot, Gauge, Activity, Waves, CircleOff, type LucideIcon,
} from 'lucide-react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { ScreenHealth } from '@/lib/bindings/ScreenHealth';
import { useTranslation } from '@/i18n/useTranslation';
import {
  FLEET_STATE_META, laneOfState, FLEET_LANE_ORDER, FLEET_LANE_LABEL_KEY, FLEET_LANE_TONE,
  type FleetStateMeta, type FleetAttentionLane, type FleetTranslations,
} from '../fleetStateMeta';
import type { MonitorTerminal } from './monitorTypes';

/** State → icon, complementing `FLEET_STATE_META`'s colour/label palette. */
export const STATE_ICON: Record<FleetSessionState, LucideIcon> = {
  awaiting_input: CircleHelp,
  running: Loader2,
  spawning: Sparkles,
  idle: CircleCheck,
  stale: Clock,
  finished: SquareCheckBig,
  hibernated: MoonStar,
  exited: Ban,
};

const META_BY_ID = new Map(FLEET_STATE_META.map((m) => [m.id, m]));
export function stateMeta(state: FleetSessionState): FleetStateMeta {
  return META_BY_ID.get(state) ?? FLEET_STATE_META[FLEET_STATE_META.length - 1]!;
}

/**
 * Screen-movement verdict, as icon + tone + the sentence it means.
 *
 * A session whose spinner still turns while nothing progresses looks perfectly
 * healthy by every other signal in the ledger — bytes keep arriving, so
 * liveness keeps advancing. This column is the one place that difference shows.
 * It is a READ of the last delta a render already took: no verdict simply means
 * nobody has rendered that session yet.
 */
const SCREEN_HEALTH_META: Record<ScreenHealth, { Icon: LucideIcon; tone: string; hintKey: keyof FleetTranslations }> = {
  working: {
    Icon: Activity,
    tone: 'text-status-success',
    hintKey: 'monitor_screen_working',
  },
  cosmetic: {
    Icon: Waves,
    tone: 'text-status-warning',
    hintKey: 'monitor_screen_cosmetic',
  },
  silent: {
    Icon: CircleOff,
    tone: 'text-status-error',
    hintKey: 'monitor_screen_silent',
  },
};

/** The ledger's screen-health glyph. Renders a muted dash when unmeasured. */
export function ScreenHealthGlyph({ health }: { health: ScreenHealth | null }) {
  const { t } = useTranslation();
  if (!health) {
    return (
      <span className="typo-caption text-foreground opacity-30" title={t.plugins.fleet.monitor_screen_unmeasured}>
        -
      </span>
    );
  }
  const { Icon, tone, hintKey } = SCREEN_HEALTH_META[health];
  const hint = t.plugins.fleet[hintKey];
  return (
    <span className="inline-flex" title={hint} aria-label={hint} role="img">
      <Icon className={`w-3.5 h-3.5 ${tone}`} aria-hidden="true" />
    </span>
  );
}

/** 0..1 "resource cost" blend of effort tokens and live memory. */
export function costRatio(t: MonitorTerminal): number {
  const tokenPart = Math.min(t.outputTokens / 240_000, 1);
  const memPart = Math.min(t.memMb / 520, 1);
  return tokenPart * 0.7 + memPart * 0.3;
}

export function costToneText(ratio: number): string {
  if (ratio > 0.66) return 'text-status-error';
  if (ratio > 0.33) return 'text-status-warning';
  return 'text-status-success';
}

export function costToneBg(ratio: number): string {
  if (ratio > 0.66) return 'bg-status-error';
  if (ratio > 0.33) return 'bg-status-warning';
  return 'bg-status-success';
}

/** Attention lanes shared by the triage variant + ledger sort. */
// Lane taxonomy lives in ../fleetStateMeta so the footer cluster tallies with
// the SAME grouping this ledger renders — re-exported here for the monitor's
// own consumers.
export type AttentionLane = FleetAttentionLane;

export function attentionLane(t: MonitorTerminal): AttentionLane {
  return laneOfState(t.state);
}

export const LANE_ORDER = FLEET_LANE_ORDER;
export const LANE_LABEL_KEY = FLEET_LANE_LABEL_KEY;
export const LANE_TONE = FLEET_LANE_TONE;

/** Compact icon+value stat used across the monitor's surfaces. */
export function MicroStat({
  icon: Icon, value, title, tone, dimZero = true,
}: {
  icon: LucideIcon;
  value: string | number;
  title: string;
  tone?: string;
  dimZero?: boolean;
}) {
  const zero = value === 0 || value === '0';
  return (
    <span
      className={`inline-flex items-center gap-0.5 typo-caption ${zero && dimZero ? 'text-foreground opacity-40' : tone ?? 'text-foreground opacity-80'}`}
      title={title}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      <span className="font-data" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

/** The three per-terminal stats the monitor exists to surface. */
export function TerminalStats({ terminal, className }: { terminal: MonitorTerminal; className?: string }) {
  const { t, tx } = useTranslation();
  const ratio = costRatio(terminal);
  const tokensK = Math.round(terminal.outputTokens / 1000);
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <MicroStat
        icon={Cpu}
        value={terminal.subprocs}
        title={tx(t.plugins.fleet.monitor_stat_subprocs, { count: terminal.subprocs })}
      />
      <MicroStat
        icon={Bot}
        value={terminal.subagentsActive > 0 ? `${terminal.subagentsActive}/${terminal.subagentsTotal}` : terminal.subagentsTotal}
        title={tx(t.plugins.fleet.monitor_stat_subagents, {
          active: terminal.subagentsActive,
          total: terminal.subagentsTotal,
        })}
        tone={terminal.subagentsActive > 0 ? 'text-status-info' : undefined}
        dimZero={terminal.subagentsTotal === 0}
      />
      <MicroStat
        icon={Gauge}
        value={`${tokensK}k`}
        title={
          terminal.memMb
            ? tx(t.plugins.fleet.monitor_stat_effort, { tokens: tokensK, mem: terminal.memMb })
            : tx(t.plugins.fleet.monitor_stat_effort_no_process, { tokens: tokensK })
        }
        tone={costToneText(ratio)}
        dimZero={false}
      />
    </span>
  );
}

/** Thin resource-cost meter (tokens+RAM blend) used as a card underline. */
export function CostMeter({ t, className }: { t: MonitorTerminal; className?: string }) {
  const ratio = costRatio(t);
  return (
    <div className={`h-0.5 w-full bg-secondary/40 overflow-hidden ${className ?? ''}`} aria-hidden="true">
      <div
        className={`h-full ${costToneBg(ratio)} opacity-70 transition-[width] duration-300`}
        style={{ width: `${Math.max(ratio * 100, 4)}%` }}
      />
    </div>
  );
}
