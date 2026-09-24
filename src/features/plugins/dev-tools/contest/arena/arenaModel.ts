// Arena — pure helpers behind the race metaphor. No React, no IO; unit-tested
// in __tests__/arenaModel.test.ts.
import type { ContestChain } from '@/lib/bindings/ContestChain';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestReview } from '@/lib/bindings/ContestReview';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import type { ContestKey } from '../focus';

// ── Roster ────────────────────────────────────────────────────────────────

export interface RosterEntry {
  summary: ContestSummary;
  /** 0 for a first race, 1+ for refine rounds nested under their parent. */
  depth: number;
}

const idOf = (s: Pick<ContestSummary, 'projectId' | 'contestId'>) => `${s.projectId}/${s.contestId}`;

/**
 * Contests as a parent → child tree, flattened in display order. A round sits
 * directly under the race it refines; a round whose parent is not listed is
 * shown as a root (never dropped). Input order (newest first) is kept among
 * siblings.
 */
export function raceRounds(contests: readonly ContestSummary[]): RosterEntry[] {
  const known = new Set(contests.map(idOf));
  const children = new Map<string, ContestSummary[]>();
  const roots: ContestSummary[] = [];
  for (const c of contests) {
    const parent = c.parentId ? `${c.projectId}/${c.parentId}` : null;
    if (parent && known.has(parent) && parent !== idOf(c)) {
      const list = children.get(parent) ?? [];
      list.push(c);
      children.set(parent, list);
    } else {
      roots.push(c);
    }
  }
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  const walk = (c: ContestSummary, depth: number) => {
    const id = idOf(c);
    if (seen.has(id)) return; // a malformed parent cycle never loops
    seen.add(id);
    out.push({ summary: c, depth });
    const kids = [...(children.get(id) ?? [])].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // Anything only reachable through a cycle still gets a row.
  for (const c of contests) if (!seen.has(idOf(c))) walk(c, 0);
  return out;
}

const LIVE_PHASES: readonly ContestPhase[] = ['queued', 'running', 'collecting', 'judging'];

export function isLivePhase(phase: ContestPhase): boolean {
  return LIVE_PHASES.includes(phase);
}

/** What the track shows: the focused race, else the newest live one, else
 *  the newest one waiting for review, else nothing. Never writes focus. */
export function pickTrackKey(focused: ContestKey | null, contests: readonly ContestSummary[]): ContestKey | null {
  if (focused) return focused;
  const pick =
    contests.find((c) => isLivePhase(c.phase)) ?? contests.find((c) => c.phase === 'review') ?? null;
  return pick ? { projectId: pick.projectId, contestId: pick.contestId } : null;
}

/** Where a focused contest belongs: the photo finish once it has variants to
 *  sort, otherwise the track. */
export function relevantLayer(phase: ContestPhase | null): 'review' | 'track' {
  return phase === 'review' || phase === 'shortlisted' ? 'review' : 'track';
}

// ── Lanes ─────────────────────────────────────────────────────────────────

export interface Lane {
  seat: ContestSeat;
  variants: ContestVariant[];
}

/** One lane per seat; participants first, judges (stewards) after. */
export function buildLanes(detail: Pick<ContestDetail, 'seats' | 'variants'>): { racers: Lane[]; stewards: Lane[] } {
  const bySeat = new Map<string, ContestVariant[]>();
  for (const v of detail.variants) {
    const list = bySeat.get(v.seatId) ?? [];
    list.push(v);
    bySeat.set(v.seatId, list);
  }
  const lane = (seat: ContestSeat): Lane => ({
    seat,
    variants: [...(bySeat.get(seat.seatId) ?? [])].sort((a, b) => a.n - b.n),
  });
  return {
    racers: detail.seats.filter((s) => s.kind === 'participant').map(lane),
    stewards: detail.seats.filter((s) => s.kind === 'judge').map(lane),
  };
}

export type LaneStage = 'grid' | 'racing' | 'finished' | 'out';

export function laneStage(state: ContestSeatState): LaneStage {
  switch (state) {
    case 'idle':
    case 'queued':
      return 'grid';
    case 'running':
      return 'racing';
    case 'completed':
      return 'finished';
    default:
      return 'out';
  }
}

/**
 * The runner's position on the lane, 0 (grid) … 1 (finish line). A racing
 * seat sits at elapsed ÷ ceiling, clamped short of the line; when either is
 * unknown it sits at the midpoint rather than inventing progress. A seat that
 * stopped short (seat limit, timeout, error) is drawn where it stopped when
 * its wall time is known, else at the midpoint.
 */
export function lanePosition(
  state: ContestSeatState,
  elapsedS: number | null,
  ceilingS: number | null,
  wallS: number | null = null,
): number {
  const frac = (t: number | null) =>
    t !== null && ceilingS !== null && ceilingS > 0 ? Math.min(Math.max(t / ceilingS, 0), 1) : null;
  switch (laneStage(state)) {
    case 'grid':
      return 0;
    case 'finished':
      return 1;
    case 'racing':
      return Math.min(frac(elapsedS) ?? 0.5, 0.97);
    case 'out':
      return state === 'timed-out' ? 1 : (frac(wallS) ?? 0.5);
  }
}

/** Seconds since a start time, or null when the start is unknown. */
export function elapsedSince(startMs: number | null | undefined, nowMs: number): number | null {
  if (startMs == null || !Number.isFinite(startMs) || startMs <= 0) return null;
  return Math.max(0, (nowMs - startMs) / 1000);
}

// ── Finish line (autopilot chain) ─────────────────────────────────────────

export type ChainStationId = 'collect' | 'visual' | 'judges' | 'ready';
export type StationStatus = 'done' | 'active' | 'pending' | 'skipped' | 'failed';

export interface ChainStation {
  id: ChainStationId;
  status: StationStatus;
}

const STATION_ORDER: readonly ChainStationId[] = ['collect', 'visual', 'judges', 'ready'];

/**
 * The chain as four stations. The sidecar records the step it is ON, not the
 * one that failed, so a failed chain marks only the final station failed and
 * leaves the rest pending (the retry buttons name the steps).
 */
export function chainStations(
  chain: Pick<ContestChain, 'step'>,
  judgesEnabled: boolean,
  phase: ContestPhase,
): ChainStation[] {
  const pastChain = phase === 'review' || phase === 'shortlisted' || phase === 'decided';
  const activeIndex: Record<ContestChain['step'], number> = {
    idle: pastChain ? 4 : -1,
    collecting: 0,
    visual: 1,
    judging: 2,
    ready: 4,
    failed: -2,
  };
  const at = activeIndex[chain.step];
  return STATION_ORDER.map((id, i) => {
    if (id === 'judges' && !judgesEnabled) return { id, status: 'skipped' };
    if (at === -2) return { id, status: id === 'ready' ? 'failed' : 'pending' };
    if (at === -1) return { id, status: 'pending' };
    if (i < at || at === 4) return { id, status: 'done' };
    if (i === at) return { id, status: 'active' };
    return { id, status: 'pending' };
  });
}

// ── Photo finish (review) ─────────────────────────────────────────────────

export type TrayId = ContestReviewBucket | 'unsorted';

/** Variant keys per tray, in manifest order. */
export function trays(review: ContestReview | null, variants: readonly Pick<ContestVariant, 'key'>[]): Record<TrayId, string[]> {
  const out: Record<TrayId, string[]> = { winner: [], shortlist: [], impractical: [], failure: [], unsorted: [] };
  const bucketOf = new Map((review?.variants ?? []).map((v) => [v.key, v.bucket]));
  for (const v of variants) out[bucketOf.get(v.key) ?? 'unsorted'].push(v.key);
  return out;
}

/** Wraparound neighbour in the lightbox filmstrip. */
export function stepKey(keys: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (keys.length === 0) return null;
  const i = current ? keys.indexOf(current) : -1;
  if (i < 0) return keys[0]!;
  return keys[(i + delta + keys.length) % keys.length]!;
}

/** The seat spec that built a variant (winners show their maker). */
export function makerSpec(detail: Pick<ContestDetail, 'seats'>, variant: Pick<ContestVariant, 'seatId'>): string | null {
  return detail.seats.find((s) => s.seatId === variant.seatId)?.spec ?? null;
}
