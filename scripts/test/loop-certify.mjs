// LOOP CERTIFICATION (§9) — verdict-producing scorecard for the AUTONOMOUS
// LOOP itself, over a day-scale observation window. The seeded cert runs
// (run.mjs → evaluate.mjs) grade a 30-minute burst; the "works weeks
// unattended" claim is about CONTINUOUS operation — goal-advance feeding
// teams from self-generated backlog, parked reviews draining, no silent
// stalls. This scores exactly that, deterministically, from the live DB
// (read-only; no LLM, no app dependency).
//
//   node scripts/test/loop-certify.mjs                  # last 24h
//   node scripts/test/loop-certify.mjs --hours 48
//   node scripts/test/loop-certify.mjs --json           # machine-readable
//
// §9 dimensions:
//   liveness   — progress-uptime (fraction of window hours with ≥1 execution
//                start), stall episodes (gaps > STALL_HOURS), recovery.
//   fairness   — per-team execution + goals-done spread (X2 check).
//   drain      — awaiting_review inflow vs outflow + current parked age.
//   athena     — §8 scorer over the window's fleet-wide channel trail.
//   loop fuel  — backlog promotion + idea replenishment activity (X1 check).
//
// Verdict: LIVE (uptime ok, no unrecovered stall, parked draining),
// DEGRADED (moving but with stalls/hoarding/parked growth), STALLED
// (an unrecovered stall ends the window, or zero progress with work).
import { openRead, MAIN_DB } from './db.mjs';
import { athenaOrchestration } from './lib/eval/athena.mjs';

const args = process.argv.slice(2);
const HOURS = (() => {
  const i = args.indexOf('--hours');
  return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 24) : 24;
})();
const AS_JSON = args.includes('--json');
/** A gap this long with actionable work available counts as a stall episode. */
const STALL_HOURS = 2;
/** Liveness floor: fraction of window hours that must show ≥1 execution start. */
const UPTIME_FLOOR = 0.5;

const db = openRead(MAIN_DB);
const sinceExpr = `datetime('now', '-${HOURS} hours')`;

// --- canonical teams ---------------------------------------------------------
const teams = db
  .prepare(
    `SELECT dp.team_id AS teamId, t.name AS teamName, dp.id AS projectId, dp.name AS projectName
     FROM dev_projects dp JOIN persona_teams t ON t.id = dp.team_id
     WHERE dp.team_id IS NOT NULL ORDER BY t.name`,
  )
  .all();
const teamIds = teams.map((t) => t.teamId);
const ph = teamIds.map(() => '?').join(',');

// --- per-team executions (persona_executions.created_at is RFC3339 'T' —
//     datetime()-wrap before comparing; the recurring bit class) -------------
const perTeam = teams.map((t) => {
  const ex = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS fail,
              SUM(CASE WHEN e.status = 'failed' AND COALESCE(e.error_message,'') LIKE '%App restarted%' THEN 1 ELSE 0 END) AS restartKills,
              SUM(CASE WHEN e.status = 'failed' AND (COALESCE(e.error_message,'') LIKE '%quota%' OR COALESCE(e.error_message,'') LIKE '%usage limit%') THEN 1 ELSE 0 END) AS quotaFails,
              ROUND(SUM(COALESCE(e.cost_usd,0)), 2) AS cost
       FROM persona_executions e
       JOIN persona_team_members m ON m.persona_id = e.persona_id AND m.team_id = ?
       WHERE datetime(e.created_at) > ${sinceExpr}`,
    )
    .get(t.teamId);
  const goalsDone = db
    .prepare(
      `SELECT COUNT(*) AS n FROM dev_goals g
       WHERE g.project_id = ? AND g.status IN ('done','completed')
         AND datetime(g.updated_at) > ${sinceExpr}`,
    )
    .get(t.projectId).n;
  const parked = db
    .prepare(
      `SELECT COUNT(*) AS n FROM team_assignments
       WHERE team_id = ? AND status = 'awaiting_review'`,
    )
    .get(t.teamId).n;
  return { ...t, ...ex, total: ex.total || 0, goalsDone, parked };
});

// --- §9.1 liveness: hourly buckets + stall episodes --------------------------
const buckets = db
  .prepare(
    `SELECT strftime('%Y-%m-%dT%H', datetime(created_at)) AS h, COUNT(*) AS n
     FROM persona_executions
     WHERE datetime(created_at) > ${sinceExpr}
     GROUP BY h ORDER BY h`,
  )
  .all();
// Clamp: the bucket count can exceed the window by one partial hour at each
// edge (observed 7 buckets over a 6h window → 117%); uptime is capped at 100.
const activeHours = Math.min(buckets.length, HOURS);
const uptimePct = Math.min(100, Math.round((activeHours / HOURS) * 100));

// Stall episodes: walk execution start times (fleet-wide), flag gaps > STALL_HOURS.
const execTimes = db
  .prepare(
    `SELECT datetime(created_at) AS ts FROM persona_executions
     WHERE datetime(created_at) > ${sinceExpr} ORDER BY ts`,
  )
  .all()
  .map((r) => new Date(r.ts.replace(' ', 'T') + 'Z').getTime());
const windowStart = Date.now() - HOURS * 3600_000;
const points = [windowStart, ...execTimes, Date.now()];
const stallEpisodes = [];
for (let i = 1; i < points.length; i++) {
  const gapMs = points[i] - points[i - 1];
  if (gapMs > STALL_HOURS * 3600_000) {
    stallEpisodes.push({
      from: new Date(points[i - 1]).toISOString(),
      to: new Date(points[i]).toISOString(),
      hours: +(gapMs / 3600_000).toFixed(1),
      ongoing: i === points.length - 1,
    });
  }
}
const ongoingStall = stallEpisodes.find((s) => s.ongoing) || null;

// Work availability NOW (qualifies an ongoing gap as a real stall vs done-state).
const workNow = {
  openGoals: db
    .prepare(
      `SELECT COUNT(*) AS n FROM dev_goals g JOIN dev_projects dp ON dp.id = g.project_id
       WHERE dp.team_id IS NOT NULL AND g.status NOT IN ('done','completed') AND g.progress < 100`,
    )
    .get().n,
  pendingIdeas: db
    .prepare(
      `SELECT COUNT(*) AS n FROM dev_ideas i JOIN dev_projects dp ON dp.id = i.project_id
       WHERE dp.team_id IS NOT NULL AND i.status = 'pending'`,
    )
    .get().n,
  parked: perTeam.reduce((s, t) => s + t.parked, 0),
};
const workAvailable = workNow.openGoals + workNow.pendingIdeas + workNow.parked > 0;
const stalledNow = !!ongoingStall && workAvailable;

// --- §9.2 fairness (X2): spread across teams ---------------------------------
const totals = perTeam.map((t) => t.total).sort((a, b) => b - a);
const fleetTotal = totals.reduce((s, n) => s + n, 0);
const top2Share = fleetTotal ? Math.round(((totals[0] + (totals[1] || 0)) / fleetTotal) * 100) : null;
const teamsActive = perTeam.filter((t) => t.total > 0).length;
const fairness = {
  teamsActive: `${teamsActive}/${teams.length}`,
  top2SharePct: top2Share,
  perTeamExecs: Object.fromEntries(perTeam.map((t) => [t.teamName, t.total])),
  hoarding: top2Share != null && top2Share > 60 && teamsActive < teams.length,
};

// --- §9.3 parked-review drain -------------------------------------------------
const resolutionEvents = db
  .prepare(
    `SELECT COUNT(*) AS n FROM team_assignment_events
     WHERE kind = 'athena_review_resolution' AND datetime(created_at) > ${sinceExpr}`,
  )
  .get().n;
const parkedInflow = db
  .prepare(
    `SELECT COUNT(*) AS n FROM team_assignment_events e
     JOIN team_assignments a ON a.id = e.assignment_id
     WHERE e.kind = 'qa_changes_requested_rework' AND a.team_id IN (${ph})
       AND datetime(e.created_at) > ${sinceExpr}`,
  )
  .get(...teamIds).n;
const oldestParkedDays = db
  .prepare(
    `SELECT ROUND((julianday('now') - julianday(MIN(datetime(created_at)))), 1) AS d
     FROM team_assignments WHERE status = 'awaiting_review' AND team_id IS NOT NULL`,
  )
  .get().d;
const drain = {
  parkedNow: workNow.parked,
  athenaResolutions: resolutionEvents,
  qaBouncesInWindow: parkedInflow,
  oldestParkedDays: oldestParkedDays ?? 0,
  blackHole: workNow.parked > 0 && resolutionEvents === 0 && (oldestParkedDays ?? 0) > 1,
};

// --- §9.4 Athena §8 over the fleet-wide window trail --------------------------
const channelMessages = db
  .prepare(
    `SELECT author_kind, body, addressed_to, consumer, assignment_id, created_at
     FROM team_channel_messages WHERE team_id IN (${ph}) AND datetime(created_at) > ${sinceExpr}`,
  )
  .all(...teamIds);
const assignments = db
  .prepare(
    `SELECT id, title, status, goal_id, created_at, completed_at
     FROM team_assignments WHERE team_id IN (${ph}) AND datetime(created_at) > ${sinceExpr}`,
  )
  .all(...teamIds);
const aIds = assignments.map((a) => a.id);
const assignmentEvents = aIds.length
  ? db
      .prepare(
        `SELECT assignment_id, kind, created_at FROM team_assignment_events
         WHERE assignment_id IN (${aIds.map(() => '?').join(',')})`,
      )
      .all(...aIds)
  : [];
const athena = athenaOrchestration({ channelMessages, assignments, assignmentEvents });

// --- §9.5 loop fuel (X1): promotion + replenishment activity ------------------
const fuel = {
  goalsCreated: db
    .prepare(
      `SELECT COUNT(*) AS n FROM dev_goals g JOIN dev_projects dp ON dp.id = g.project_id
       WHERE dp.team_id IS NOT NULL AND datetime(g.created_at) > ${sinceExpr}`,
    )
    .get().n,
  ideasCreated: db
    .prepare(
      `SELECT COUNT(*) AS n FROM dev_ideas i JOIN dev_projects dp ON dp.id = i.project_id
       WHERE dp.team_id IS NOT NULL AND datetime(i.created_at) > ${sinceExpr}`,
    )
    .get().n,
  goalRelations: (() => {
    try {
      return db
        .prepare(`SELECT COUNT(*) AS n FROM dev_goal_dependencies WHERE datetime(created_at) > ${sinceExpr}`)
        .get().n;
    } catch {
      return null;
    }
  })(),
};

db.close();

// --- verdict fold --------------------------------------------------------------
let verdict = 'LIVE';
const reasons = [];
if (uptimePct < UPTIME_FLOOR * 100) {
  verdict = 'DEGRADED';
  reasons.push(`progress-uptime ${uptimePct}% < ${UPTIME_FLOOR * 100}% floor`);
}
if (stallEpisodes.some((s) => !s.ongoing)) {
  verdict = 'DEGRADED';
  reasons.push(`${stallEpisodes.filter((s) => !s.ongoing).length} recovered stall episode(s)`);
}
if (fairness.hoarding) {
  verdict = 'DEGRADED';
  reasons.push(`top-2 teams hold ${fairness.top2SharePct}% of executions while ${teams.length - teamsActive} team(s) idle`);
}
if (drain.blackHole) {
  verdict = 'DEGRADED';
  reasons.push(`parked reviews not draining (${drain.parkedNow} parked, oldest ${drain.oldestParkedDays}d, 0 resolutions)`);
}
if (stalledNow) {
  verdict = 'STALLED';
  reasons.push(`ONGOING stall: no executions for ${ongoingStall.hours}h with work available (${workNow.openGoals} goals / ${workNow.pendingIdeas} ideas / ${workNow.parked} parked)`);
}
if (fleetTotal === 0 && workAvailable) {
  verdict = 'STALLED';
  reasons.push('zero executions in the whole window with work available');
}

const report = {
  windowHours: HOURS,
  generatedAt: new Date().toISOString(),
  verdict,
  reasons,
  liveness: { uptimePct, activeHours, windowHours: HOURS, stallEpisodes, workNow },
  fairness,
  drain,
  fuel,
  ...(athena ? { athena_orchestration: athena } : {}),
  perTeam: perTeam.map((t) => ({
    team: t.teamName,
    execs: t.total,
    ok: t.ok || 0,
    fail: t.fail || 0,
    restartKills: t.restartKills || 0,
    quotaFails: t.quotaFails || 0,
    genuineFail: (t.fail || 0) - (t.restartKills || 0) - (t.quotaFails || 0),
    goalsDone: t.goalsDone,
    parked: t.parked,
    costUsd: t.cost || 0,
  })),
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const v = verdict === 'LIVE' ? '✅ LIVE' : verdict === 'DEGRADED' ? '⚠️ DEGRADED' : '⛔ STALLED';
  console.log(`§9 LOOP CERTIFICATION — last ${HOURS}h\nverdict: ${v}`);
  for (const r of reasons) console.log(`  - ${r}`);
  console.log(`\nliveness: uptime ${uptimePct}% (${activeHours}/${HOURS}h active), ${stallEpisodes.length} stall episode(s)${ongoingStall ? ` — ONGOING ${ongoingStall.hours}h` : ''}`);
  console.log(`fairness: ${fairness.teamsActive} teams active, top-2 share ${fairness.top2SharePct ?? 'n/a'}%${fairness.hoarding ? ' (HOARDING)' : ''}`);
  console.log(`drain: ${drain.parkedNow} parked, ${drain.athenaResolutions} athena resolution(s), oldest ${drain.oldestParkedDays}d${drain.blackHole ? ' (BLACK HOLE)' : ''}`);
  console.log(`fuel: ${fuel.goalsCreated} goals + ${fuel.ideasCreated} ideas created, ${fuel.goalRelations ?? 'n/a'} goal relations`);
  if (athena) {
    const ax = athena.axes;
    console.log(`athena §8: ${athena.facts.athenaPosts} posts, coverage ${ax.coverage.criticalCoveragePct ?? 'n/a'}%, soundness ${ax.soundness.soundnessPct ?? 'n/a'}%, audit ${ax.auditability.auditablePct ?? 'n/a'}%, restraint ${ax.restraint.restraintOk ? 'ok' : 'REVIEW'}`);
  }
  console.log('\nper-team:');
  console.log('team'.padEnd(34), 'execs ok fail genuine goals parked cost');
  for (const t of report.perTeam) {
    console.log(
      t.team.padEnd(34),
      String(t.execs).padEnd(5),
      String(t.ok).padEnd(2),
      String(t.fail).padEnd(4),
      String(t.genuineFail).padEnd(7),
      String(t.goalsDone).padEnd(5),
      String(t.parked).padEnd(6),
      `$${t.costUsd}`,
    );
  }
}
