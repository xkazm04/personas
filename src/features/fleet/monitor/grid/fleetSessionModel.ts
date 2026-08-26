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

/**
 * `border-*` twins of `FLEET_STATE_META[].dot`. Same hue, same shade — the only
 * reason this table exists at all is that Tailwind cannot generate a class that
 * is assembled at runtime. Keep it in lockstep with the canonical table (a test
 * enforces it); do NOT pick different colours here.
 */
export const SESSION_BORDER: Record<FleetSessionState, string> = {
  awaiting_input: 'border-violet-400',
  running: 'border-blue-400',
  spawning: 'border-cyan-400',
  idle: 'border-emerald-400',
  stale: 'border-orange-400',
  finished: 'border-teal-400',
  hibernated: 'border-indigo-400',
  exited: 'border-zinc-500',
};

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
  /** Sessions whose cwd maps to no project, or to a project with no team. */
  ungrouped: FleetSession[];
}

/**
 * Group live sessions into team columns via cwd → DevProject → team_id.
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
  const ungrouped: FleetSession[] = [];
  for (const s of sessions) {
    if (!isLiveSession(s)) continue;
    const teamId = s.cwd ? teamByRoot.get(normPath(s.cwd)) : undefined;
    if (teamId) {
      const list = byTeam.get(teamId);
      if (list) list.push(s);
      else byTeam.set(teamId, [s]);
    } else {
      ungrouped.push(s);
    }
  }

  for (const list of byTeam.values()) list.sort(compareSessions);
  ungrouped.sort(compareSessions);
  return { byTeam, ungrouped };
}

/** Attention-first, then newest — the same reading order the fleet surfaces use. */
function compareSessions(a: FleetSession, b: FleetSession): number {
  const ra = STATE_RANK.get(a.state) ?? 99;
  const rb = STATE_RANK.get(b.state) ?? 99;
  if (ra !== rb) return ra - rb;
  return Number(b.createdAtMs) - Number(a.createdAtMs);
}
