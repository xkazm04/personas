// One filter for every card on the panel. The four state tags in the command
// bar narrow AGENTS (the persona roster) and SESSIONS (live Claude sessions)
// alike, in all three layouts, so a tag's number is always the count of cards
// it will leave on screen.
//
// A session is folded into the same four buckets a persona uses:
//   running   - running, spawning                     (work in flight)
//   attention - awaiting_input, stale                 (needs the operator)
//   failed    - exited with a non-zero exit code      (its last run broke)
//   idle      - idle, queued, hibernated, finished, a clean exit
// It mirrors `fleetStateMeta.laneOfState` (needs_you / working / parked+done)
// with "done" split by how it ended.

import { useMemo } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../../monitorModel';
import { squareState, type SquareState } from '../../fleetGridModel';
import { isLiveSession } from '../../fleetSessionModel';
import type { BoardVariant } from '../../board/queue/boardVariant';
import type { ActivitySurface } from '../useActivitySurface';

/** Exited sessions stay on the Lanes board for this long (`LanesBoard`'s rule). */
export const PARKED_WINDOW_MS = 60 * 60 * 1_000;

export function isParked(s: FleetSession, now: number): boolean {
  if (s.state === 'hibernated' || s.state === 'finished') return true;
  return s.state === 'exited' && now - Number(s.lastActivityMs) <= PARKED_WINDOW_MS;
}

export function sessionBucket(s: Pick<FleetSession, 'state' | 'exitCode'>): SquareState {
  switch (s.state) {
    case 'running':
    case 'spawning':
      return 'running';
    case 'awaiting_input':
    case 'stale':
      return 'attention';
    case 'exited':
      return s.exitCode !== null && s.exitCode !== 0 ? 'failed' : 'idle';
    default:
      return 'idle';
  }
}

const ZERO: Record<SquareState, number> = { running: 0, attention: 0, failed: 0, idle: 0 };

export interface PanelFilter {
  state: SquareState | null;
  active: boolean;
  /** Per state: how many agents and how many sessions the tag would show. */
  counts: Record<SquareState, { agents: number; sessions: number }>;
  agentTotal: number;
  sessionTotal: number;
  card: (c: PersonaCardModel) => boolean;
  session: (s: Pick<FleetSession, 'state' | 'exitCode'>) => boolean;
}

/** The sessions a layout can put on screen: live ones, plus Lanes' parked exits. */
function universe(list: readonly FleetSession[], layout: BoardVariant, now: number): FleetSession[] {
  return list.filter((s) => isLiveSession(s) || (layout === 'lanes' && isParked(s, now)));
}

export function usePanelFilter(surface: ActivitySurface): PanelFilter {
  const state = surface.filter.state;
  const { totals } = surface.model;
  const { sessionList } = surface.board;
  const layout = surface.layout;
  return useMemo(() => {
    const sessions = { ...ZERO };
    const shown = universe(sessionList, layout, Date.now());
    for (const s of shown) sessions[sessionBucket(s)] += 1;
    const counts = {} as PanelFilter['counts'];
    for (const k of Object.keys(ZERO) as SquareState[]) counts[k] = { agents: totals[k], sessions: sessions[k] };
    return {
      state,
      active: state !== null,
      counts,
      agentTotal: totals.running + totals.attention + totals.failed + totals.idle,
      sessionTotal: shown.length,
      card: (c) => state === null || squareState(c) === state,
      session: (s) => state === null || sessionBucket(s) === state,
    };
  }, [state, totals, sessionList, layout]);
}
