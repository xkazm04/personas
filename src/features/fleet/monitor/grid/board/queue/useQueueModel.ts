// useQueueModel — the queue boards' one shape, derived from two sources.
//
// The registry (`fleetSessions`) knows every session and its state; the queue
// snapshot (`fleet_queue_snapshot`) knows the cap, the live count, how far
// "start now" has pushed past it, and — for queued rows only — rank, origin
// and an estimated start. Neither alone is a board: the registry has no
// estimates and the snapshot has no titles. `buildQueueModel` joins them by
// session id and hands every board the same two lists.
//
// A queued session the SNAPSHOT does not know (an event landed before the
// coalesced re-read) still appears, with `rank: null`, at the end of the
// queued list in the registry's own `queueRank` order — the board never drops
// a row it can see because a second read is 150 ms behind. Pure: the hook is
// a memo over the function, and the function is what the tests drive.

import { useMemo } from 'react';
import type { DispatchOrigin } from '@/lib/bindings/DispatchOrigin';
import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { DevProject } from '@/lib/bindings/DevProject';
import { isLiveSession } from '../../fleetSessionModel';

/** The origin tokens the queue can name. Anything else reads as `manual`. */
const ORIGINS: ReadonlySet<string> = new Set<DispatchOrigin>([
  'manual', 'dev_runner', 'dispatch_ideas', 'athena', 'autopilot', 'night_shift', 'feed_impact', 'orphan_resume', 'remote',
]);

export function asOrigin(raw: string | null | undefined): DispatchOrigin {
  // The row stores its origin as a snake_case token; a row written before the
  // queue existed has none. Both read as an operator's own dispatch.
  return raw && ORIGINS.has(raw) ? (raw as DispatchOrigin) : 'manual';
}

/**
 * Milliseconds since epoch that the door ESTIMATED (`now + rank × mean of the
 * last twenty durations`) — not a measurement. Named so the provenance
 * survives the annotation: never sum or average one with a `createdAtMs`
 * (data-provenance-disclosure golden path). The `bigint` on the binding
 * (`FleetQueueEntry.estimatedStartMs`) is narrowed to this once, here.
 */
export type EstimatedMs = number;

export interface QueueItem {
  sessionId: string;
  session: FleetSession;
  /** 1-based, dense, from the snapshot; `null` for a live row or a queued row
   *  the snapshot has not caught up with. */
  rank: number | null;
  origin: DispatchOrigin;
  personaId: string | null;
  goalId: string | null;
  teamId?: string;
  projectLabel: string;
  /** The verbs do not apply: a row that is not `queued` cannot be dragged,
   *  cancelled from the queue or started now. */
  locked: boolean;
  /** Only meaningful for a queued row: `now + rank × mean recent duration`,
   *  or `null` when the door has no history to estimate from. */
  estimatedStartMs: EstimatedMs | null;
  /** The row's earliest-start gate, when it has one. */
  notBeforeMs: number | null;
}

export interface QueueModel {
  /** Live (non-queued, non-exited) sessions, oldest first — the ones holding slots. */
  running: QueueItem[];
  /** Queued rows, rank ascending. */
  queued: QueueItem[];
  cap: number;
  /** `max(0, running − cap)`, straight from the door. */
  overAdmitted: number;
  /** Nothing is running and nothing is queued. */
  empty: boolean;
}

/** Normalise a path for cwd↔root matching — mirrors `fleetSessionModel.normPath`. */
const normPath = (p: string): string => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

function num(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

/**
 * The join. `personas`/`teams` are accepted for the persona-owned row (a
 * dispatch a persona asked for names it) — the team comes from the persona's
 * home team when the cwd resolves to no project, so an Autopilot dispatch
 * still lands in its team's column on the ranked grid.
 */
export function buildQueueModel(
  sessions: readonly FleetSession[],
  snapshot: FleetQueueSnapshot | null,
  personas: readonly Persona[] = [],
  teams: readonly PersonaTeam[] = [],
  projects: readonly DevProject[] = [],
): QueueModel {
  const entryById = new Map((snapshot?.entries ?? []).map((e) => [e.sessionId, e]));
  const teamByRoot = new Map<string, string>();
  for (const p of projects) if (p.root_path && p.team_id) teamByRoot.set(normPath(p.root_path), p.team_id);
  const homeTeamByPersona = new Map<string, string>();
  const teamIds = new Set(teams.map((t) => t.id));
  for (const p of personas) {
    if (p.home_team_id && (teamIds.size === 0 || teamIds.has(p.home_team_id))) {
      homeTeamByPersona.set(p.id, p.home_team_id);
    }
  }

  const toItem = (s: FleetSession): QueueItem => {
    const entry = entryById.get(s.id);
    const personaId = entry?.personaId ?? s.personaId ?? null;
    const teamId =
      (s.cwd ? teamByRoot.get(normPath(s.cwd)) : undefined)
      ?? (personaId ? homeTeamByPersona.get(personaId) : undefined);
    return {
      sessionId: s.id,
      session: s,
      rank: s.state === 'queued' ? (entry?.rank ?? null) : null,
      origin: asOrigin(entry?.origin ?? s.origin),
      personaId,
      goalId: entry?.goalId ?? s.goalId ?? null,
      teamId,
      projectLabel: s.projectLabel,
      locked: s.state !== 'queued',
      estimatedStartMs: s.state === 'queued' ? num(entry?.estimatedStartMs) : null,
      notBeforeMs: num(entry?.notBeforeMs ?? s.notBeforeMs),
    };
  };

  const running: QueueItem[] = [];
  const queued: QueueItem[] = [];
  for (const s of sessions) {
    if (!isLiveSession(s)) continue;
    if (s.state === 'queued') queued.push(toItem(s));
    else running.push(toItem(s));
  }
  running.sort((a, b) => Number(a.session.createdAtMs) - Number(b.session.createdAtMs));
  // Snapshot rank first; rows the snapshot has not seen sort after every ranked
  // row, in the registry's own rank (then arrival) order.
  queued.sort((a, b) => {
    const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    const qa = a.session.queueRank ?? Number.MAX_SAFE_INTEGER;
    const qb = b.session.queueRank ?? Number.MAX_SAFE_INTEGER;
    if (qa !== qb) return qa - qb;
    return Number(a.session.queuedAtMs ?? 0) - Number(b.session.queuedAtMs ?? 0);
  });

  return {
    running,
    queued,
    cap: snapshot?.cap ?? 0,
    overAdmitted: snapshot?.overAdmitted ?? 0,
    empty: running.length === 0 && queued.length === 0,
  };
}

export function useQueueModel(
  sessions: readonly FleetSession[],
  snapshot: FleetQueueSnapshot | null,
  personas: readonly Persona[],
  teams: readonly PersonaTeam[],
  projects: readonly DevProject[],
): QueueModel {
  return useMemo(
    () => buildQueueModel(sessions, snapshot, personas, teams, projects),
    [sessions, snapshot, personas, teams, projects],
  );
}
