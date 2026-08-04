import {
  Ban, CircleCheck, CircleHelp, Clock, Loader2, MoonStar, Sparkles, SquareCheckBig,
  Cpu, Bot, Gauge, Activity, Waves, CircleOff, type LucideIcon,
} from 'lucide-react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { ScreenHealth } from '@/lib/bindings/ScreenHealth';
import { FLEET_STATE_META, type FleetStateMeta } from '../fleetStateMeta';
import type { ProtoTerminal } from './monitorTypes';

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
const SCREEN_HEALTH_META: Record<ScreenHealth, { Icon: LucideIcon; tone: string; hint: string }> = {
  working: {
    Icon: Activity,
    tone: 'text-status-success',
    hint: 'Screen is producing output.',
  },
  cosmetic: {
    Icon: Waves,
    tone: 'text-status-warning',
    hint: 'Only chrome is moving (spinner, timer). Alive, but not producing.',
  },
  silent: {
    Icon: CircleOff,
    tone: 'text-status-error',
    hint: 'Screen has not changed at all since the last render.',
  },
};

/** The ledger's screen-health glyph. Renders a muted dash when unmeasured. */
export function ScreenHealthGlyph({ health }: { health: ScreenHealth | null }) {
  if (!health) {
    return (
      <span className="typo-caption text-foreground opacity-30" title="No screen render taken yet.">
        -
      </span>
    );
  }
  const { Icon, tone, hint } = SCREEN_HEALTH_META[health];
  return (
    <span className="inline-flex" title={hint} aria-label={hint} role="img">
      <Icon className={`w-3.5 h-3.5 ${tone}`} aria-hidden="true" />
    </span>
  );
}

/** 0..1 "resource cost" blend of effort tokens and live memory. */
export function costRatio(t: ProtoTerminal): number {
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
export type AttentionLane = 'needs_you' | 'working' | 'parked' | 'done';

export function attentionLane(t: ProtoTerminal): AttentionLane {
  if (t.state === 'awaiting_input' || t.state === 'stale') return 'needs_you';
  if (t.state === 'running' || t.state === 'spawning') return 'working';
  if (t.state === 'idle' || t.state === 'hibernated') return 'parked';
  return 'done';
}

export const LANE_ORDER: AttentionLane[] = ['needs_you', 'working', 'parked', 'done'];

export const LANE_LABEL: Record<AttentionLane, string> = {
  needs_you: 'Needs you',
  working: 'Working',
  parked: 'Parked',
  done: 'Done',
};

export const LANE_TONE: Record<AttentionLane, string> = {
  needs_you: 'text-violet-300',
  working: 'text-blue-300',
  parked: 'text-emerald-300',
  done: 'text-foreground opacity-50',
};

/** Compact icon+value stat used across all three variants. */
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

/** The three per-terminal stats the prototype exists to surface. */
export function TerminalStats({ t, className }: { t: ProtoTerminal; className?: string }) {
  const ratio = costRatio(t);
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <MicroStat icon={Cpu} value={t.subprocs} title={`${t.subprocs} background subprocesses`} />
      <MicroStat
        icon={Bot}
        value={t.subagentsActive > 0 ? `${t.subagentsActive}/${t.subagentsTotal}` : t.subagentsTotal}
        title={`Subagents — ${t.subagentsActive} active, ${t.subagentsTotal} triggered total`}
        tone={t.subagentsActive > 0 ? 'text-status-info' : undefined}
        dimZero={t.subagentsTotal === 0}
      />
      <MicroStat
        icon={Gauge}
        value={`${Math.round(t.outputTokens / 1000)}k`}
        title={`~${Math.round(t.outputTokens / 1000)}k output tokens · ${t.memMb ? `${t.memMb} MB RAM` : 'no process'}`}
        tone={costToneText(ratio)}
        dimZero={false}
      />
    </span>
  );
}

/** Thin resource-cost meter (tokens+RAM blend) used as a card underline. */
export function CostMeter({ t, className }: { t: ProtoTerminal; className?: string }) {
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
