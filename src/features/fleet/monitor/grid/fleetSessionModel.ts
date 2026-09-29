// fleetSessionModel — mapping live Claude (Fleet) sessions onto the Activity board.
//
// A Fleet session is a temporary Claude CLI process dispatched under a Dev-Tools
// project. It is NOT a persona, so it never becomes a PersonaSquare: it hangs
// below the roster, under a divider, as a smaller square whose BORDER carries
// the session lifecycle state.
//
// Two things are deliberately reused rather than reinvented:
//
//   1. The state→hue decision comes from `FLEET_STATE_META`
//      (features/plugins/fleet/fleetStateMeta.ts) — the same table the fleet
//      footer, the summary pills and the Monitor ledger read, so a session can
//      never wear violet here and blue there. We only add the literal
//      `border-*` twin of each `dot: bg-*` class, because Tailwind's scanner
//      needs the class to appear verbatim in source; a computed
//      `dot.replace('bg-','border-')` would never be generated.
//      `fleetSessionModel.test.ts` asserts the twins stay in lockstep, so a
//      hue change in the canonical table fails a test instead of drifting.
//
//   2. The session→column mapping reuses the app's existing cwd↔root_path
//      convention: a FleetSession carries NO project id, only its `cwd`, and
//      `fleetSlice` already resolves projects by normalizing that path against
//      `DevProject.root_path`. The team column then comes from the project's
//      `team_id` (nullable, no FK — an orphan binding lands in Ungrouped).
//
// Pure module: no JSX, no i18n. Labels are resolved by the component via
// `t.plugins.fleet[labelKey]`, exactly like every other fleet surface.

import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { FLEET_STATE_META, type FleetStateMeta } from '@/features/plugins/fleet/fleetStateMeta';

const META_BY_STATE = new Map<FleetSessionState, FleetStateMeta>(FLEET_STATE_META.map((m) => [m.id, m]));
/** Attention-first rank — the canonical table's own order. */
const STATE_RANK = new Map<FleetSessionState, number>(FLEET_STATE_META.map((m, i) => [m.id, i]));

export function sessionStateMeta(state: FleetSessionState): FleetStateMeta {
  // `exited` is the documented fallback in every other fleet consumer.
  return META_BY_STATE.get(state) ?? FLEET_STATE_META[FLEET_STATE_META.length - 1]!;
}

/**
 * A session is "live" for the board when it still represents work in the world.
 * `exited` is the one terminal state — the registry keeps exited rows around so
 * the Fleet page can show the tail, but a monitor that is answering "what is
 * running right now" would only be padded by them.
 */
export function isLiveSession(s: { state: FleetSessionState }): boolean {
  return s.state !== 'exited';
}

/** The name a session shows to a human: live terminal title > user name > project. */
export function sessionLabel(s: FleetSession): string {
  return (s.title?.trim() || s.name?.trim() || s.projectLabel?.trim() || s.id.slice(0, 8));
}

/**
 * 2–3 character identity for a square that is 30px wide. Words give their
 * initials ("build api docs" → "BAD"); a single word gives its first three
 * letters ("refactor" → "REF"), which is far more distinguishable at this size
 * than one capital.
 */
export function sessionGlyph(s: FleetSession): string {
  const raw = sessionLabel(s).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim();
  if (!raw) return '··';
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]!).join('').toUpperCase();
  return words[0]!.slice(0, 3).toUpperCase();
}

/** Normalize a path for cwd↔root matching — mirrors `fleetSlice.normPath`. */
const normPath = (p: string): string => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

export interface SessionGrouping {
  /** teamId → its sessions, attention-first. Only non-empty teams appear. */
  byTeam: Map<string, FleetSession[]>;
  /**
   * Run-group key → its sessions, attention-first. Today the only run group is
   * a contest: key `contest:<projectId>/<contestId>` (`contest:<contestId>` for
   * a seat labelled before the project joined its run label), one per contest
   * with seats on the board, ordered newest contest first. A run group wins over the team
   * mapping — a contest's seats run in its arena folders, not a project root,
   * and belong together whatever project the arena sits in.
   */
  byRun: Map<string, FleetSession[]>;
  /** Sessions whose cwd maps to no project, or to a project with no team. */
  ungrouped: FleetSession[];
}

/** Prefix of a contest's run-group key (`contest:<projectId>/<contestId>`). */
export const CONTEST_GROUP_PREFIX = 'contest:';

/** A contest column's identity. `projectId` is null only for seats labelled
 *  before the project joined the run label: their contest cannot be told apart
 *  from a same-id contest in another project, nor opened. */
export interface ContestGroup {
  projectId: string | null;
  contestId: string;
}

/**
 * The run-group key of a contest. Arenas are per project and contest ids are
 * unique only inside one arena (`contest/focus.ts`), so the key is the pair:
 * `contest:<projectId>/<contestId>`. Neither half can hold a `/` (a project
 * id is a UUID, a contest id a `[A-Za-z0-9._-]` slug). With no project it
 * falls back to `contest:<contestId>`.
 */
export function contestGroupKey(contestId: string, projectId: string | null): string {
  return projectId ? `${CONTEST_GROUP_PREFIX}${projectId}/${contestId}` : `${CONTEST_GROUP_PREFIX}${contestId}`;
}

/** The (project, contest) back out of a run-group key, or `null` for another kind of key. */
export function contestOfGroupKey(key: string): ContestGroup | null {
  if (!key.startsWith(CONTEST_GROUP_PREFIX)) return null;
  const rest = key.slice(CONTEST_GROUP_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return rest ? { projectId: null, contestId: rest } : null;
  const projectId = rest.slice(0, slash);
  const contestId = rest.slice(slash + 1);
  return projectId && contestId ? { projectId, contestId } : null;
}

/**
 * Group live sessions into team columns via cwd → DevProject → team_id, and
 * contest seats into one run group per contest.
 *
 * Everything unresolvable lands in `ungrouped` on purpose: a session running in
 * an unregistered directory is still real work the operator started, and
 * dropping it would make the board quietly lie about how much is in flight.
 */
export function groupSessions(sessions: FleetSession[], projects: DevProject[]): SessionGrouping {
  const teamByRoot = new Map<string, string>();
  for (const p of projects) {
    if (p.root_path && p.team_id) teamByRoot.set(normPath(p.root_path), p.team_id);
  }

  const byTeam = new Map<string, FleetSession[]>();
  const runGroups = new Map<string, FleetSession[]>();
  const ungrouped: FleetSession[] = [];
  const push = (map: Map<string, FleetSession[]>, key: string, s: FleetSession) => {
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  };
  for (const s of sessions) {
    if (!isLiveSession(s)) continue;
    // The fleet parses the seat's `contest:<projectId>/<contestId>:<seatId>`
    // run label once and sends both halves; the board only groups on them.
    const contestId = s.contestId?.trim();
    if (contestId) {
      push(runGroups, contestGroupKey(contestId, s.contestProjectId?.trim() || null), s);
      continue;
    }
    const teamId = s.cwd ? teamByRoot.get(normPath(s.cwd)) : undefined;
    if (teamId) push(byTeam, teamId, s);
    else ungrouped.push(s);
  }

  for (const list of byTeam.values()) list.sort(compareSessions);
  for (const list of runGroups.values()) list.sort(compareSessions);
  ungrouped.sort(compareSessions);
  // Newest contest first: the one being run now leads the board's run columns.
  const newest = (list: FleetSession[]) => Math.max(...list.map((s) => Number(s.createdAtMs)));
  const byRun = new Map(
    [...runGroups.entries()].sort(([ka, a], [kb, b]) => newest(b) - newest(a) || (ka < kb ? -1 : ka > kb ? 1 : 0)),
  );
  return { byTeam, byRun, ungrouped };
}

/** Attention-first, then newest — the same reading order the fleet surfaces use. */
function compareSessions(a: FleetSession, b: FleetSession): number {
  const ra = STATE_RANK.get(a.state) ?? 99;
  const rb = STATE_RANK.get(b.state) ?? 99;
  if (ra !== rb) return ra - rb;
  return Number(b.createdAtMs) - Number(a.createdAtMs);
}
