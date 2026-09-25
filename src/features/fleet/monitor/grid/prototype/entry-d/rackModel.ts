// The room's shared facts: which rack slot a session holds, which queue rank
// it waits at, and which session the operator's pointer is on. One number per
// session, printed in the console gauge, on the board and in the tooltip, so a
// seat found in one place has a findable place in every other.

import { createContext, useContext } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { QueueItem } from '../../board/queue/useQueueModel';

/** How a session's lamp is lit. The names are this entry's CSS vocabulary. */
export type SessionLamp = 'live' | 'input' | 'quiet' | 'stale' | 'done' | 'sleep' | 'queued' | 'gone';

const LAMP: Record<FleetSessionState, SessionLamp> = {
  running: 'live',
  spawning: 'live',
  awaiting_input: 'input',
  idle: 'quiet',
  stale: 'stale',
  finished: 'done',
  hibernated: 'sleep',
  queued: 'queued',
  exited: 'gone',
};

export function sessionLamp(state: FleetSessionState): SessionLamp {
  return LAMP[state] ?? 'quiet';
}

/** Mirrors `isParked` in `board/queue/LanesBoard.tsx`, which does not export it. */
const PARKED_WINDOW_MS = 60 * 60 * 1_000;
export function isParked(s: FleetSession, now: number): boolean {
  if (s.state === 'hibernated' || s.state === 'finished') return true;
  return s.state === 'exited' && now - Number(s.lastActivityMs) <= PARKED_WINDOW_MS;
}

export interface RackIndex {
  /** sessionId -> 1-based slot in the rack (creation order, as the runway seats them). */
  slotOf: ReadonlyMap<string, number>;
  /** sessionId -> 1-based queue rank (the operator's current order). */
  rankOf: ReadonlyMap<string, number>;
}

/**
 * Which states hold a seat and count toward the cap. A stale, finished or
 * hibernated session is still on the board, but it is not in the rack.
 *
 * Keyed by the generated `FleetSessionState` union and checked with
 * `satisfies Record<…>`: a state the server adds does not compile here until
 * someone decides whether it holds a seat, instead of silently falling to
 * "no". The server's own answer is `is_live_state` in the fleet registry.
 */
const HOLDS_SEAT = {
  queued: false,
  spawning: true,
  running: true,
  awaiting_input: true,
  idle: true,
  stale: false,
  finished: false,
  hibernated: false,
  exited: false,
} satisfies Record<FleetSessionState, boolean>;

export function holdsSeat(state: FleetSessionState): boolean {
  return HOLDS_SEAT[state];
}

export function rackIndex(running: readonly QueueItem[], queued: readonly QueueItem[]): RackIndex {
  const slotOf = new Map<string, number>();
  running.filter((it) => holdsSeat(it.session.state)).forEach((it, i) => slotOf.set(it.sessionId, i + 1));
  const rankOf = new Map<string, number>();
  queued.forEach((it, i) => rankOf.set(it.sessionId, i + 1));
  return { slotOf, rankOf };
}

/** Two-digit seat number: `07`, `12`. */
export const seat = (n: number): string => String(n).padStart(2, '0');

export interface RoomContextValue extends RackIndex {
  cap: number;
  /** The session the pointer rests on, anywhere in the room. */
  hot: string | null;
  setHot: (id: string | null) => void;
  openSession: (s: FleetSession) => void;
  recapSession: (s: FleetSession) => void;
  focusKey: string | null;
  motion: boolean;
}

const NOOP = () => {};
export const RoomContext = createContext<RoomContextValue>({
  slotOf: new Map(),
  rankOf: new Map(),
  cap: 0,
  hot: null,
  setHot: NOOP,
  openSession: NOOP,
  recapSession: NOOP,
  focusKey: null,
  motion: false,
});

export const useRoom = () => useContext(RoomContext);

/** `12s`, `4m`, `3h`, `9d`: an age that can be minutes or weeks. */
export function ageLabel(fromMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Age as a 0..1 fill on a log scale: a minute is a sliver, a week is full. */
export function ageFrac(fromMs: number, now: number): number {
  const min = Math.max(1, (now - fromMs) / 60_000);
  return Math.min(1, Math.log10(min) / Math.log10(7 * 24 * 60));
}
