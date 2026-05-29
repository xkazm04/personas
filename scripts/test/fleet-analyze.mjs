#!/usr/bin/env node
// FLEET ANALYZE — post-certification "are the teams on track?" watcher.
//
// Reads the live app DB read-only (NEVER writes — the app owns it) and
// produces a per-team gap report: execution health, business outcomes,
// Director verdicts, goal progress, and a roster-validity / on-track
// assessment. This is the analysis ENGINE behind the planned Athena
// "Analyze fleet" side-panel skill, and doubles as the Phase-2 watcher for
// the CICD goal (is it on track? are only valid personas involved?).
//
// Mirrors the autonomy-eval gather layer (scripts/test/gather.mjs) — same
// read-only SQLite truth, same DB helper (db.mjs). Defensive by design: a
// missing table/column degrades that section to a note rather than crashing,
// because the schema can drift between runs.
//
// Usage:
//   node scripts/test/fleet-analyze.mjs                  # all enabled teams, 7-day window
//   node scripts/test/fleet-analyze.mjs --team <id|name> # one team
//   node scripts/test/fleet-analyze.mjs --days 14        # custom window
//   node scripts/test/fleet-analyze.mjs --json out.json  # also write JSON
//   node scripts/test/fleet-analyze.mjs --goal <goalId>  # focus a single CICD goal's team
import { writeFileSync } from 'node:fs';
import { openRead, MAIN_DB } from './db.mjs';

// ── args ──────────────────────────────────────────────────────────────────
function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const TEAM_FILTER = arg('team');
const GOAL_FILTER = arg('goal');
const DAYS = Math.max(1, Math.min(365, Number(arg('days', '7')) || 7));
const JSON_OUT = arg('json');
const SINCE_ISO = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

// ── small helpers ───────────────────────────────────────────────────────────
function safe(label, fn, fallback) {
  try {
    return fn();
  } catch (e) {
    notes.push(`(${label}: ${e.message})`);
    return fallback;
  }
}
const notes = [];
const inClause = (n) => Array.from({ length: n }, () => '?').join(',');
const pct = (n, d) => (d > 0 ? Math.round((100 * n) / d) : 0);

// ── data access ─────────────────────────────────────────────────────────────
function listTeams(db) {
  const rows = safe('teams', () =>
    db.prepare(`SELECT id, name, COALESCE(enabled, 1) AS enabled FROM persona_teams`).all(), []);
  return rows.filter((t) => {
    if (!TEAM_FILTER) return t.enabled;
    return t.id === TEAM_FILTER || (t.name || '').toLowerCase().includes(TEAM_FILTER.toLowerCase());
  });
}

// Declared roster (persona_team_members) and the runtime anchor (home_team_id)
// can differ; we want both to judge "are only valid personas involved".
function rosterFor(db, teamId) {
  const members = safe('roster', () =>
    db.prepare(
      `SELECT m.persona_id, m.role, p.name, COALESCE(p.enabled,1) AS enabled
       FROM persona_team_members m LEFT JOIN personas p ON p.id = m.persona_id
       WHERE m.team_id = ?`,
    ).all(teamId), []);
  const homed = safe('home_team', () =>
    db.prepare(`SELECT id AS persona_id, name FROM personas WHERE home_team_id = ?`).all(teamId), []);
  const ids = new Set([...members.map((m) => m.persona_id), ...homed.map((h) => h.persona_id)]);
  return { members, homed, validIds: ids };
}

function executionsFor(db, personaIds) {
  if (!personaIds.length) return [];
  const ph = inClause(personaIds.length);
  return safe('executions', () =>
    db.prepare(
      `SELECT id, persona_id, status, business_outcome, cost_usd, duration_ms,
              director_score, retry_of_execution_id, COALESCE(is_simulation,0) AS is_simulation,
              error_message, created_at
       FROM persona_executions
       WHERE persona_id IN (${ph}) AND created_at >= ?
       ORDER BY created_at ASC`,
    ).all(...personaIds, SINCE_ISO), []);
}

function directorVerdicts(db, personaIds) {
  if (!personaIds.length) return [];
  const ph = inClause(personaIds.length);
  return safe('director_verdicts', () =>
    db.prepare(
      `SELECT id, persona_id, severity, title, status, context_data, created_at
       FROM persona_manual_reviews
       WHERE persona_id IN (${ph}) AND created_at >= ?
         AND context_data LIKE '%"source":"director"%'
       ORDER BY created_at DESC LIMIT 20`,
    ).all(...personaIds, SINCE_ISO), []);
}

function goalsFor(db, teamId) {
  // team_assignments soft-links to dev_goals via goal_id.
  const assignments = safe('assignments', () =>
    db.prepare(
      `SELECT id, title, goal, status, goal_id, created_at
       FROM team_assignments WHERE team_id = ? ORDER BY created_at DESC LIMIT 20`,
    ).all(teamId), []);
  const goalIds = [...new Set(assignments.map((a) => a.goal_id).filter(Boolean))];
  let goals = [];
  if (goalIds.length) {
    const ph = inClause(goalIds.length);
    goals = safe('goals', () =>
      db.prepare(
        `SELECT id, title, status, progress, target_date, updated_at
         FROM dev_goals WHERE id IN (${ph})`,
      ).all(...goalIds), []);
  }
  return { assignments, goals };
}

// ── summarization ─────────────────────────────────────────────────────────
function summarize(execs) {
  const real = execs.filter((e) => !e.is_simulation);
  const by = (key) => real.reduce((m, e) => ((m[e[key] || 'unknown'] = (m[e[key] || 'unknown'] || 0) + 1), m), {});
  const status = by('status');
  const outcome = by('business_outcome');
  const cost = real.reduce((s, e) => s + (e.cost_usd || 0), 0);
  const retries = real.filter((e) => e.retry_of_execution_id).length;
  const scored = real.filter((e) => e.director_score != null);
  const avgScore = scored.length ? scored.reduce((s, e) => s + e.director_score, 0) / scored.length : null;
  const failed = (status.failed || 0) + (status.error || 0) + (status.timeout || 0);
  const completed = status.completed || 0;
  return {
    total: real.length,
    status,
    outcome,
    failed,
    completed,
    failureRate: pct(failed, real.length),
    valueDeliveredRate: pct(outcome.value_delivered || 0, real.length),
    cost: Number(cost.toFixed(4)),
    retries,
    avgDirectorScore: avgScore == null ? null : Number(avgScore.toFixed(2)),
  };
}

// On-track heuristics — clearly labeled, not a precise verdict. Mirrors the
// spirit of the cert rubric (value delivery, failure health, goal motion).
function assessOnTrack(sum, goalsInfo, roster, execs) {
  const flags = [];
  const activeGoals = goalsInfo.goals.filter((g) => g.status !== 'done');
  // A team can be orchestrated two ways: event-chains (the original SDLC flow)
  // or goal-driven team_assignments. "No goal link" means we can't track it
  // against an objective — informational, NOT "not orchestrated".
  if (!goalsInfo.assignments.length && !goalsInfo.goals.length)
    flags.push('NO-GOAL-LINK: runs via event-chains but is not tied to a tracked goal (no team_assignment / dev_goal)');
  else if (goalsInfo.assignments.length && !goalsInfo.goals.length)
    flags.push('UNLINKED: assignment(s) exist but none link a dev_goal (goal_id null)');
  if (sum.total === 0) flags.push(`IDLE: no executions in the last ${DAYS}d`);
  if (sum.failureRate >= 30) flags.push(`HIGH-FAILURE: ${sum.failureRate}% of runs failed`);
  if (sum.total > 0 && sum.valueDeliveredRate < 30) flags.push(`LOW-VALUE: only ${sum.valueDeliveredRate}% value_delivered`);
  if (sum.avgDirectorScore != null && sum.avgDirectorScore < 2) flags.push(`LOW-SCORE: avg Director score ${sum.avgDirectorScore}/5`);
  for (const g of activeGoals) {
    const stale = g.updated_at && (Date.now() - Date.parse(g.updated_at)) > 7 * 864e5;
    if (stale && (g.progress || 0) < 100) flags.push(`STALLED-GOAL: "${g.title}" at ${g.progress || 0}% unchanged >7d`);
  }
  // roster validity: any executor outside the declared/home roster?
  const execIds = new Set(execs.map((e) => e.persona_id));
  const stray = [...execIds].filter((id) => !roster.validIds.has(id));
  if (stray.length) flags.push(`STRAY-PERSONAS: ${stray.length} executor(s) not in the team roster`);

  const onTrack = flags.length === 0;
  return { onTrack, flags, stray, activeGoals };
}

// ── render ──────────────────────────────────────────────────────────────────
function renderTeam(t, sum, goalsInfo, roster, assessment, verdicts) {
  const lines = [];
  lines.push(`\n### ${t.name}  \`${t.id}\``);
  lines.push(`- roster: ${roster.members.length} member(s)${roster.homed.length ? ` (+${roster.homed.length} home-anchored)` : ''}`);
  lines.push(`- executions (${DAYS}d): ${sum.total} · completed ${sum.completed} · failed ${sum.failed} (${sum.failureRate}%) · retries ${sum.retries}`);
  lines.push(`- value delivered: ${sum.valueDeliveredRate}% · cost $${sum.cost}` + (sum.avgDirectorScore != null ? ` · avg Director ${sum.avgDirectorScore}/5` : ''));
  const outc = Object.entries(sum.outcome).map(([k, v]) => `${k}:${v}`).join('  ');
  if (outc) lines.push(`- outcomes: ${outc}`);
  if (goalsInfo.goals.length) {
    lines.push(`- goals:`);
    for (const g of goalsInfo.goals) lines.push(`    • "${g.title}" — ${g.status} ${g.progress || 0}%${g.target_date ? ` (due ${g.target_date})` : ''}`);
  }
  const open = verdicts.filter((v) => v.status !== 'resolved' && v.status !== 'accepted' && v.status !== 'rejected');
  if (open.length) {
    lines.push(`- open Director verdicts (${open.length}):`);
    for (const v of open.slice(0, 3)) lines.push(`    • [${v.severity}] ${v.title}`);
  }
  const verdict = assessment.onTrack ? 'ON TRACK ✓' : `NEEDS ATTENTION (${assessment.flags.length})`;
  lines.push(`- assessment: ${verdict}`);
  for (const f of assessment.flags) lines.push(`    ⚠ ${f}`);
  return lines.join('\n');
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  let db;
  try {
    db = openRead(MAIN_DB);
  } catch (e) {
    console.error(`Cannot open app DB at ${MAIN_DB}: ${e.message}`);
    console.error('Run the desktop app at least once so the DB exists, or set PERSONAS_DB.');
    process.exit(2);
  }

  // --goal focuses the team owning that goal's assignment.
  let goalTeamId = null;
  if (GOAL_FILTER) {
    const a = safe('goal_team', () =>
      db.prepare(`SELECT team_id FROM team_assignments WHERE goal_id = ? LIMIT 1`).get(GOAL_FILTER), null);
    goalTeamId = a?.team_id || null;
    if (!goalTeamId) notes.push(`(no team_assignment links goal ${GOAL_FILTER} yet)`);
  }

  let teams = listTeams(db);
  if (goalTeamId) teams = teams.filter((t) => t.id === goalTeamId);

  const report = [];
  const json = { generatedAt: new Date().toISOString(), windowDays: DAYS, teams: [] };

  for (const t of teams) {
    const roster = rosterFor(db, t.id);
    const personaIds = [...roster.validIds];
    const execs = executionsFor(db, personaIds);
    const sum = summarize(execs);
    const goalsInfo = goalsFor(db, t.id);
    const verdicts = directorVerdicts(db, personaIds);
    const assessment = assessOnTrack(sum, goalsInfo, roster, execs);
    report.push(renderTeam(t, sum, goalsInfo, roster, assessment, verdicts));
    json.teams.push({ id: t.id, name: t.name, summary: sum, goals: goalsInfo.goals, verdicts, assessment });
  }

  db.close();

  const attention = json.teams.filter((t) => !t.assessment.onTrack);
  const header = [
    `# Fleet analysis — ${json.teams.length} team(s), last ${DAYS}d`,
    `generated ${json.generatedAt}`,
    `${attention.length} team(s) need attention; ${json.teams.length - attention.length} on track.`,
  ].join('\n');

  console.log(header);
  console.log(report.join('\n'));
  if (notes.length) console.log(`\n_notes: ${notes.join(' ')}_`);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(json, null, 2));
    console.log(`\nJSON written to ${JSON_OUT}`);
  }

  // Non-zero exit when any team needs attention — usable as a watcher gate.
  process.exit(attention.length ? 1 : 0);
}

main();
