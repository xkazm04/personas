// Shared words and glyphs for a session card, whichever shape it takes (the
// lean Runway window or the compact two-row line of Lanes and Classic).

import type { LucideIcon } from 'lucide-react';
import { Activity, Check, CircleDashed, Circle, Clock, Hourglass, MessageSquare, Moon, Square } from 'lucide-react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { useTranslation } from '@/i18n/useTranslation';
import type { useSessionFacts } from '../shared';
import { compactAge } from './tone';

type Facts = ReturnType<ReturnType<typeof useSessionFacts>>;

const STATE_ICON: Record<FleetSessionState, LucideIcon> = {
  running: Activity,
  spawning: CircleDashed,
  awaiting_input: MessageSquare,
  stale: Clock,
  queued: Hourglass,
  idle: Circle,
  finished: Check,
  hibernated: Moon,
  exited: Square,
};

export const sessionStateIcon = (s: FleetSessionState): LucideIcon => STATE_ICON[s];

/** The card's full reading, one fact per line: the tooltip and the aria label. */
export function useSessionSummary(f: Facts, now: number, over = false): string {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  return [
    f.label,
    `${f.stateLabel} · ${tx(m.node_symbol_origin, { origin: f.originLabel })}`,
    ...(f.project ? [tx(m.node_symbol_project, { name: f.project })] : []),
    tx(m.node_symbol_elapsed, { time: compactAge(Math.max(0, now - f.startedAt)) }),
    ...(over ? [m.queue_over_admitted] : []),
  ].join('\n');
}
