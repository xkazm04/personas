// The live feeder's memory: which transitions deserve a notice.
//
// Pure, so the rules are tested without events. Two notices exist:
//  - a contest's phase moving INTO `review` ("ready for review"), and
//  - a seat ending `seat-limit` (the engine's plan ran out; the owner acts).
// The FIRST observation of any contest after boot only seeds the memory: a
// contest that was already in review when the app started is not news. The
// feeder seeds a baseline at mount — phases from the list, and seat states from
// detail for contests still racing — so the first EVENT after boot is judged
// against what was true at boot, and a seat that runs out of plan then is news.
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

export interface LiveFeedMemory {
  phases: Map<string, ContestPhase>;
  seats: Map<string, ContestSeatState>;
}

export function createLiveFeedMemory(): LiveFeedMemory {
  return { phases: new Map(), seats: new Map() };
}

/** Record `phase` for `key`; true when this is a transition INTO review. */
export function observePhase(mem: LiveFeedMemory, key: string, phase: ContestPhase): boolean {
  const prev = mem.phases.get(key);
  mem.phases.set(key, phase);
  return prev !== undefined && prev !== 'review' && phase === 'review';
}

/** Record a seat's state; true when this is a transition INTO seat-limit. */
export function observeSeat(
  mem: LiveFeedMemory,
  contestKey: string,
  seatId: string,
  state: ContestSeatState,
  /** False on the contest's first observation: seed, never notify. */
  seen: boolean,
): boolean {
  const k = `${contestKey}#${seatId}`;
  const prev = mem.seats.get(k);
  mem.seats.set(k, state);
  if (!seen) return false;
  return prev !== 'seat-limit' && state === 'seat-limit';
}

/** Record seat states as a baseline (boot seeding): never notifies. */
export function seedSeats(
  mem: LiveFeedMemory,
  contestKey: string,
  seats: readonly Pick<ContestSeat, 'seatId' | 'state'>[],
): void {
  for (const seat of seats) {
    const k = `${contestKey}#${seat.seatId}`;
    if (!mem.seats.has(k)) mem.seats.set(k, seat.state);
  }
}

export type ContestNotice =
  | { kind: 'ready'; summary: ContestSummary }
  | { kind: 'seat-limit'; summary: ContestSummary; seat: Pick<ContestSeat, 'seatId' | 'spec'> };

/** The notices one refreshed contest earns. Mutates the memory. */
export function noticesFor(
  mem: LiveFeedMemory,
  summary: ContestSummary,
  seats: readonly Pick<ContestSeat, 'seatId' | 'spec' | 'state'>[],
): ContestNotice[] {
  const key = `${summary.projectId}/${summary.contestId}`;
  // Seen = a baseline exists for this contest: its seats, or at least its
  // phase (seeded from the list at boot). Only a contest first met in this
  // very event seeds silently.
  const seenSeats = mem.phases.has(key) || [...mem.seats.keys()].some((k) => k.startsWith(`${key}#`));
  const out: ContestNotice[] = [];
  for (const seat of seats) {
    if (observeSeat(mem, key, seat.seatId, seat.state, seenSeats)) out.push({ kind: 'seat-limit', summary, seat });
  }
  if (observePhase(mem, key, summary.phase)) out.push({ kind: 'ready', summary });
  return out;
}
