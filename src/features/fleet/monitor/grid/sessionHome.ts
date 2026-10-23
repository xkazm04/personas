// sessionHome — which bay a dispatched session belongs to when its cwd says nothing.
//
// `groupSessions` places a session by `cwd` → `DevProject.root_path` → `team_id`.
// That is right for a session an operator starts in a repo, and wrong for every
// session an App Master dispatches: those run in a worktree of their own, so the
// cwd matches no project and they used to fall into the Ungrouped tray (the
// owner's FireTV case, 2026-10-16: "App Master who is running tasks/fleets
// should have them in his project").
//
// Two facts on the session name the project, both filled by the read the board
// already holds (`fleet_list_sessions` → `FleetSession`), checked against the
// live database on 2026-10-16:
//
//   1. `runLabel` of a builder the headless /appmaster skill dispatched through
//      the fleet door: `fleet-door:app_master:cli-master:<slug>`. The skill
//      stamps `cli-master:<slug>` (`.claude/skills/appmaster/lib/contract.mjs`
//      `RUN_LABEL_PREFIX`, `worker.mjs` `PERSONAS_RUN_LABEL`) and the door
//      prefixes its own origin. `<slug>` is the skill's project slug: the
//      repo root's last path segment, slugified (`contract.mjs` `slugOf`). Live
//      FireTV rows: label `...cli-master:firetv`, cwd
//      `~/.personas/headless-masters/worktrees/firetv/<id>`, personaId null.
//      `sessionHome.test.ts` reads the skill's source so the two cannot drift.
//   2. `personaId` of a session a persona dispatched (the in-app App Master's
//      decide lane sets it on every worker, with an `app-master:<persona>`
//      label): the bay that persona lives in (`home_team_id`).
//
// Pure: no store, no i18n.

import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Persona } from '@/lib/bindings/Persona';

/** The headless /appmaster skill's builder label (the skill's `RUN_LABEL_PREFIX`). */
export const CLI_MASTER_LABEL = 'cli-master:';

/** The skill's slug rule: lower-case, runs of anything else become one dash, no edge dashes. */
export const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A project's skill slug: its root's last path segment, else its name. */
export function projectSlug(p: Pick<DevProject, 'root_path' | 'name'>): string {
  const root = (p.root_path ?? '').replace(/[\\/]+$/, '');
  const last = root.split(/[\\/]/).pop() ?? '';
  return slugify(last || p.name || '');
}

/** The project slug a `cli-master:` builder label names, wherever the door put it. */
export function cliMasterSlug(runLabel: string | null): string | null {
  if (!runLabel) return null;
  const at = runLabel.indexOf(CLI_MASTER_LABEL);
  if (at < 0) return null;
  const slug = slugify(runLabel.slice(at + CLI_MASTER_LABEL.length));
  return slug || null;
}

/** slug → team of every project that has one. A slug two projects share names neither. */
export function teamBySlug(projects: DevProject[]): Map<string, string> {
  const out = new Map<string, string>();
  const shared = new Set<string>();
  for (const p of projects) {
    if (!p.team_id) continue;
    const slug = projectSlug(p);
    if (!slug) continue;
    if (out.has(slug) && out.get(slug) !== p.team_id) shared.add(slug);
    else out.set(slug, p.team_id);
  }
  for (const s of shared) out.delete(s);
  return out;
}

/** The team a dispatched session's label names, or undefined. */
export function labelledTeam(s: Pick<FleetSession, 'runLabel'>, bySlug: ReadonlyMap<string, string>): string | undefined {
  const slug = cliMasterSlug(s.runLabel);
  return slug ? bySlug.get(slug) : undefined;
}

/** personaId → the team (bay) it lives in. */
export function personaHomes(personas: Pick<Persona, 'id' | 'home_team_id'>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of personas) if (p.home_team_id) out.set(p.id, p.home_team_id);
  return out;
}

/**
 * Moves every ungrouped session a persona dispatched into that persona's bay.
 * A session whose persona has no bay stays where it was. Returns the inputs
 * unchanged (same identities) when nothing moves, so a memo over the result
 * does not rebuild every column for a tray that did not change.
 */
export function claimByPersona(
  byTeam: Map<string, FleetSession[]>,
  ungrouped: FleetSession[],
  homes: ReadonlyMap<string, string>,
  compare: (a: FleetSession, b: FleetSession) => number,
): { byTeam: Map<string, FleetSession[]>; ungrouped: FleetSession[] } {
  const moved = new Map<string, FleetSession[]>();
  const rest: FleetSession[] = [];
  for (const s of ungrouped) {
    const team = s.personaId ? homes.get(s.personaId) : undefined;
    if (!team) { rest.push(s); continue; }
    const list = moved.get(team);
    if (list) list.push(s);
    else moved.set(team, [s]);
  }
  if (moved.size === 0) return { byTeam, ungrouped };
  const next = new Map(byTeam);
  for (const [team, list] of moved) next.set(team, [...(next.get(team) ?? []), ...list].sort(compare));
  return { byTeam: next, ungrouped: rest };
}
