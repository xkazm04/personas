// Shared team-model helpers for the evaluation harness (read-only).
// Resolves a team to its members, connection graph, entry persona(s), and
// pinned repo — the structural facts the run + gather layers both need.
import { tryJson } from './db.mjs';

export function resolveTeam(db, nameOrId) {
  const byId = db.prepare(`SELECT id, name FROM persona_teams WHERE id = ?`).get(nameOrId);
  if (byId) return byId;
  const byName = db.prepare(`SELECT id, name FROM persona_teams WHERE name = ?`).get(nameOrId);
  if (byName) return byName;
  // last resort: LIKE (e.g. "ai-paralegal" → "SDLC — ai-paralegal")
  return db.prepare(`SELECT id, name FROM persona_teams WHERE name LIKE ? ORDER BY name LIMIT 1`).get(`%${nameOrId}%`) || null;
}

export function teamMembers(db, teamId) {
  return db
    .prepare(
      `SELECT m.id AS member_id, m.persona_id, m.role, p.name, p.setup_status, p.design_context
       FROM persona_team_members m JOIN personas p ON p.id = m.persona_id
       WHERE m.team_id = ?`,
    )
    .all(teamId);
}

export function teamConnections(db, teamId) {
  return db
    .prepare(
      `SELECT source_member_id AS src, target_member_id AS dst, connection_type AS type, condition
       FROM persona_team_connections WHERE team_id = ?`,
    )
    .all(teamId);
}

/** Entry personas = members not targeted by any NON-feedback edge. */
export function entryPersonaIds(members, connections) {
  const nonFeedbackTargets = new Set(connections.filter((c) => c.type !== 'feedback').map((c) => c.dst));
  return new Set(members.filter((m) => !nonFeedbackTargets.has(m.member_id)).map((m) => m.persona_id));
}

/** The repo a code-track team is pinned to (from any member's design_context.dev_project_id).
 * Also surfaces the project's `standards_config` (the pre-commit + branching
 * policy set in the Dev Tools pipeline) so the eval layer can score §7
 * standards compliance. `standardsConfig` is null when the column is unset. */
export function teamRepo(db, members) {
  for (const m of members) {
    const dc = tryJson(m.design_context);
    const pid = dc?.dev_project_id || dc?.devProjectId;
    if (pid) {
      const dp = db.prepare(`SELECT name, root_path, standards_config FROM dev_projects WHERE id = ?`).get(pid);
      if (dp) return { projectId: pid, name: dp.name, root: dp.root_path, standardsConfig: tryJson(dp.standards_config) ?? null };
    }
  }
  return null;
}

/** Full structural snapshot used to seed + verify a run. */
export function teamInfo(db, nameOrId) {
  const team = resolveTeam(db, nameOrId);
  if (!team) throw new Error(`team not found: ${nameOrId}`);
  const members = teamMembers(db, team.id);
  const connections = teamConnections(db, team.id);
  const entry = entryPersonaIds(members, connections);
  return {
    ...team,
    members,
    connections,
    personaIds: members.map((m) => m.persona_id),
    entryPersonaIds: [...entry],
    entryMembers: members.filter((m) => entry.has(m.persona_id)),
    repo: teamRepo(db, members),
  };
}
