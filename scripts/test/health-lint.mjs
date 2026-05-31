// Persona-health lint — the PRE-RUN GATE (docs/tests/autonomy-eval/evaluation-rubric.md §4)
// and the standalone P1 baseline (docs/tests/autonomy-eval/run-protocol.md §9).
//
// Read-only. Answers: "are these teams structurally sound enough that running
// them would teach us anything?" A team that cannot autonomously cascade, or
// whose members are degraded, must be FIXED before we spend LLM budget grading
// its output (grading a broken team teaches nothing).
//
// Usage:
//   node scripts/test/health-lint.mjs                 # lint the 7 SDLC — <repo> teams, write report
//   node scripts/test/health-lint.mjs --pattern 'SDLC%'   # custom team name LIKE pattern
//   node scripts/test/health-lint.mjs --json          # also emit JSON to stdout
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openRead, tryJson, MAIN_DB } from './db.mjs';

const XPRICE_ROOT = 'xprice'; // pinned repos are expected under C:\Users\mkdol\xprice\
// Trigger types that let a member receive an autonomous handoff (an upstream
// member's completion reaching it). `manual` and `schedule` do NOT count —
// manual needs a human, schedule is a clock, neither is a handoff.
const HANDOFF_TRIGGER_TYPES = new Set(['event_listener', 'chain', 'webhook', 'polling']);
// Trigger types that let an ENTRY member self-start without a human.
const SELFSTART_TRIGGER_TYPES = new Set(['schedule', 'event_listener', 'webhook', 'polling']);
// Preset roles that do CODE-TRACK work and therefore REQUIRE a codebase pin to
// read the repo. The artist (visual/brand asset generation) reads no code — a
// missing pin for it is expected, not a blocker (it just needs an image-gen
// credential; the preset notes it stays idle without one and the build cascade
// is unaffected). Unknown roles default to code-track (conservative).
const CODE_TRACK_ROLES = new Set(['architect', 'engineer', 'reviewer', 'security', 'release', 'docs', 'qa']);

/** Recover a member's semantic preset role from config ({"preset_role":"<role>"}).
 * The persona_team_members.role column is CHECK-constrained to the pipeline-role
 * enum and is always `worker` for preset members, so it can't identify the role. */
function memberPresetRole(config, role) {
  const c = tryJson(config);
  return (c && typeof c === 'object' && c.preset_role) || role || null;
}

import { argStrict as arg } from './lib/cli.mjs';
const HAS = (name) => process.argv.includes(name);

function triggerEvent(config) {
  const c = tryJson(config);
  if (!c || typeof c !== 'object') return null;
  return c.listen_event_type || c.event_type || c.eventType || c.cron || null;
}

/** Lint one persona (team member). Returns checks + member-level blockers/warns. */
function lintMember(db, m, isEntry) {
  const blockers = [];
  const warns = [];

  // --- capability / identity source ---
  const sp = tryJson(m.structured_prompt); // null=absent, undefined=corrupt
  const spState = m.structured_prompt == null || m.structured_prompt === '' ? 'absent' : sp === undefined ? 'corrupt' : 'ok';
  const dc = tryJson(m.design_context);
  const dcState = m.design_context == null || m.design_context === '' ? 'absent' : dc === undefined ? 'corrupt' : 'ok';
  const useCases = Array.isArray(dc?.use_cases) ? dc.use_cases.length : 0;
  const instrLen =
    sp && sp.instructions != null
      ? typeof sp.instructions === 'string'
        ? sp.instructions.trim().length
        : JSON.stringify(sp.instructions).length
      : 0;
  const sysLen = (m.system_prompt || '').trim().length;

  if (spState === 'corrupt') blockers.push('structured_prompt is CORRUPT JSON → runtime silently falls back to system_prompt, design intent lost');
  if (dcState === 'corrupt') warns.push('design_context is CORRUPT JSON → capabilities/pin may be dropped at runtime');
  // Capability source: instructions (structured) OR use_cases OR a real system_prompt.
  const hasCapability = instrLen > 0 || useCases > 0 || sysLen >= 50;
  if (!hasCapability) blockers.push('no capability source: empty instructions AND no use_cases AND trivial system_prompt');
  const capabilitySource = instrLen > 0 ? (useCases > 0 ? 'instructions+use_cases' : 'instructions') : useCases > 0 ? 'use_cases' : sysLen >= 50 ? 'system_prompt' : 'NONE';
  if (useCases === 0 && capabilitySource === 'instructions') {
    // informational: these SDLC personas carry their job in structured_prompt, not use_cases.
    warns.push('use_cases empty (capability is in structured_prompt.instructions — acceptable, but the runtime "Active Capabilities" section will be empty)');
  }

  // --- triggers + subscriptions (handoff wiring) ---
  const triggers = db
    .prepare(`SELECT trigger_type, enabled, config FROM persona_triggers WHERE persona_id=?`)
    .all(m.persona_id)
    .map((t) => ({ type: t.trigger_type, enabled: !!t.enabled, event: triggerEvent(t.config) }));
  const subs = db
    .prepare(`SELECT event_type, enabled FROM persona_event_subscriptions WHERE persona_id=?`)
    .all(m.persona_id)
    .map((s) => ({ event: s.event_type, enabled: !!s.enabled }));

  const enabledTriggers = triggers.filter((t) => t.enabled);
  const canReceiveHandoff =
    enabledTriggers.some((t) => HANDOFF_TRIGGER_TYPES.has(t.type)) || subs.some((s) => s.enabled);
  const canSelfStart = enabledTriggers.some((t) => SELFSTART_TRIGGER_TYPES.has(t.type));

  if (!isEntry && !canReceiveHandoff) {
    blockers.push('CANNOT receive autonomous handoff — no enabled event_listener/chain trigger and no event subscription (manual-only). The team chain dies here.');
  }
  if (isEntry && !canSelfStart) {
    warns.push('entry member cannot self-start autonomously (no schedule/event trigger) — a human or Athena must kick the chain');
  }

  // --- codebase pin (code-track) ---
  const devProjectId = dc?.dev_project_id || dc?.devProjectId || null;
  let pin = { id: devProjectId, state: 'none', repo: null, root: null };
  if (devProjectId) {
    const dp = db.prepare(`SELECT name, root_path FROM dev_projects WHERE id=?`).get(devProjectId);
    if (!dp) pin = { id: devProjectId, state: 'unresolved', repo: null, root: null };
    else pin = { id: devProjectId, state: 'ok', repo: dp.name, root: dp.root_path };
  }
  // Role-aware: a missing pin is a blocker only for code-track roles. The
  // artist reads no code, so a missing pin is expected → warn, not a blocker.
  const presetRole = memberPresetRole(m.mconfig, m.mrole);
  const isCodeTrackRole = !presetRole || CODE_TRACK_ROLES.has(presetRole);
  if (pin.state === 'none') {
    if (isCodeTrackRole) blockers.push('no codebase pin (design_context.dev_project_id missing) — code-track work cannot read the repo');
    else warns.push(`no codebase pin — expected for non-code-track role '${presetRole}' (generates assets, reads no repo)`);
  } else if (pin.state === 'unresolved') blockers.push(`codebase pin ${devProjectId.slice(0, 8)} does not resolve to a dev_projects row`);
  else if (!/xprice/i.test(pin.root || '')) warns.push(`codebase pin resolves outside xprice: ${pin.root}`);

  // --- setup / credentials ---
  if (m.setup_status && m.setup_status !== 'ready') warns.push(`setup_status=${m.setup_status} (likely missing credentials)`);

  return {
    name: m.name,
    persona_id: m.persona_id,
    isEntry,
    spState,
    dcState,
    useCases,
    capabilitySource,
    triggers,
    subs,
    canReceiveHandoff,
    canSelfStart,
    pin,
    setup_status: m.setup_status,
    blockers,
    warns,
  };
}

export function lintTeam(db, team) {
  const members = db
    .prepare(
      `SELECT m.id mid, m.role mrole, m.config mconfig, m.persona_id, p.name, p.structured_prompt, p.design_context, p.system_prompt, p.setup_status
       FROM persona_team_members m JOIN personas p ON p.id=m.persona_id WHERE m.team_id=?`,
    )
    .all(team.id);
  const conns = db
    .prepare(`SELECT source_member_id s, target_member_id t, connection_type ct FROM persona_team_connections WHERE team_id=?`)
    .all(team.id);

  // Entry = member not targeted by any NON-feedback edge (feedback loop-backs
  // don't make a member a downstream consumer).
  const nonFeedbackTargets = new Set(conns.filter((c) => c.ct !== 'feedback').map((c) => c.t));
  const midToMember = new Map(members.map((m) => [m.mid, m]));
  const entryMids = new Set(members.filter((m) => !nonFeedbackTargets.has(m.mid)).map((m) => m.mid));

  const memberResults = members.map((m) => lintMember(db, m, entryMids.has(m.mid)));

  // executions ever (context: have these personas ever run?)
  const pids = members.map((m) => m.persona_id);
  const execCount = pids.length
    ? db.prepare(`SELECT COUNT(*) c FROM persona_executions WHERE persona_id IN (${pids.map(() => '?').join(',')})`).get(...pids).c
    : 0;

  // Broken handoff edges: non-feedback edges whose target cannot receive a handoff.
  const brokenEdges = conns
    .filter((c) => c.ct !== 'feedback')
    .map((c) => ({ from: midToMember.get(c.s)?.name, to: midToMember.get(c.t)?.name, toMid: c.t }))
    .filter((e) => {
      const r = memberResults.find((mr) => mr.persona_id === midToMember.get(e.toMid)?.persona_id);
      return r && !r.canReceiveHandoff;
    });

  // Pin agreement (code-track teams should all pin the same repo).
  const resolvedRepos = [...new Set(memberResults.filter((r) => r.pin.state === 'ok').map((r) => r.pin.repo))];

  const totalBlockers = memberResults.reduce((n, r) => n + r.blockers.length, 0);
  const handoffBlockers = brokenEdges.length;

  let verdict;
  if (handoffBlockers > 0) verdict = 'CANNOT-CASCADE';
  else if (totalBlockers > 0) verdict = 'DEGRADED';
  else verdict = 'STRUCTURALLY-SOUND';

  return {
    team: team.name,
    teamId: team.id,
    memberCount: members.length,
    execCount,
    entry: members.filter((m) => entryMids.has(m.mid)).map((m) => m.name),
    connections: conns.map((c) => ({ from: midToMember.get(c.s)?.name, to: midToMember.get(c.t)?.name, type: c.ct })),
    brokenEdges,
    resolvedRepos,
    members: memberResults,
    totalBlockers,
    verdict,
  };
}

function renderMarkdown(results) {
  const ts = new Date().toISOString();
  const L = [];
  L.push('# Baseline Health Report — the 7 SDLC teams (as-adopted)');
  L.push('');
  L.push(`_Generated ${ts} by \`scripts/test/health-lint.mjs\` (read-only). See [run-protocol §9](../run-protocol.md) and [rubric §4](../evaluation-rubric.md)._`);
  L.push('');
  L.push('This is the honest starting line: **the structural state of the teams before any run or score.** A `CANNOT-CASCADE` verdict means the team\'s autonomous handoff chain is broken — running it would stall after the entry member, so it must be fixed (React phase / a product fix) before its output is worth grading.');
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('| Team | Members | Verdict | Blockers | Execs ever | Repo |');
  L.push('|---|---|---|---|---|---|');
  for (const r of results) {
    L.push(`| ${r.team} | ${r.memberCount} | **${r.verdict}** | ${r.totalBlockers} | ${r.execCount} | ${r.resolvedRepos.join(', ') || '—'} |`);
  }
  L.push('');
  const cannot = results.filter((r) => r.verdict === 'CANNOT-CASCADE').length;
  L.push(`**Headline:** ${cannot}/${results.length} teams **cannot autonomously cascade** as adopted.`);
  L.push('');
  for (const r of results) {
    L.push(`## ${r.team}`);
    L.push('');
    L.push(`- **Verdict:** \`${r.verdict}\` · members ${r.memberCount} · executions ever: ${r.execCount} · entry: ${r.entry.join(', ') || 'NONE'} · repo: ${r.resolvedRepos.join(', ') || '—'}`);
    if (r.brokenEdges.length) {
      L.push(`- **Broken handoff edges (chain dies here):** ${r.brokenEdges.map((e) => `${e.from} → **${e.to}** (no receiver)`).join('; ')}`);
    }
    L.push('');
    L.push('| Member | entry | capability | use_cases | handoff-recv | self-start | pin | setup | blockers |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const m of r.members) {
      L.push(
        `| ${m.name} | ${m.isEntry ? 'yes' : ''} | ${m.capabilitySource} | ${m.useCases} | ${m.canReceiveHandoff ? 'ok' : '**NO**'} | ${m.canSelfStart ? 'ok' : '—'} | ${m.pin.state === 'ok' ? m.pin.repo : '**' + m.pin.state + '**'} | ${m.setup_status} | ${m.blockers.length || ''} |`,
      );
    }
    L.push('');
    // detail: per-member blockers/warns
    for (const m of r.members) {
      if (m.blockers.length || m.warns.length) {
        L.push(`<details><summary>${m.name} — ${m.blockers.length} blocker(s), ${m.warns.length} warning(s)</summary>`);
        L.push('');
        for (const b of m.blockers) L.push(`- 🛑 ${b}`);
        for (const w of m.warns) L.push(`- ⚠️ ${w}`);
        const trigStr = m.triggers.map((t) => `${t.type}${t.enabled ? '' : '(off)'}${t.event ? `→${t.event}` : ''}`).join(', ') || 'none';
        const subStr = m.subs.map((s) => `${s.event}${s.enabled ? '' : '(off)'}`).join(', ') || 'none';
        L.push(`- triggers: ${trigStr}`);
        L.push(`- subscriptions: ${subStr}`);
        L.push('');
        L.push('</details>');
        L.push('');
      }
    }
    // connection graph
    L.push('Connection graph: ' + (r.connections.map((c) => `${c.from}→${c.to}[${c.type}]`).join(' · ') || 'none'));
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('## What this means (read critically)');
  L.push('');
  L.push('- A `CANNOT-CASCADE` team is **not** a persona-quality problem — it is a **wiring** problem from best-effort adoption (README §2.1, §2.3): downstream members were adopted without the event_listener/subscription that lets an upstream completion reach them, so the chain stalls after the entry member.');
  L.push('- `use_cases=0` is expected here — these SDLC personas carry their job in `structured_prompt.instructions`. The runtime "Active Capabilities" prompt section will be empty, which is acceptable but worth noting.');
  L.push('- The event types the wired members listen for (e.g. `github.pull_request.merged`, `release.published`) are **external domain events, not intra-team completion events** matching the connection graph — so even the members that *can* be triggered are not necessarily triggered *by their upstream*. The connection graph (the visual design) and the runtime event wiring are decoupled.');
  L.push('- **Root cause:** handoff event subscriptions are derived at adoption from each use-case\'s `event_subscriptions` field — but these personas have **empty `use_cases`** (their job is in `structured_prompt`), so downstream members got **no** subscriptions wired. The connection graph is never translated into runtime event wiring.');
  L.push('- **Scope caveat (rigor):** this lint measures the **autonomous event-bus cascade** path. A separate pipeline/`assign_team` orchestration path *could* drive members by the connection graph regardless of triggers — but `pipeline_runs=0` for every team and there is no orchestrator-role member, so that path has never run and is untested. Either way, an event-bus cascade is the "works unattended for weeks" autonomy we care about, and it is broken.');
  L.push('- **Implication for the framework:** before P2 runs, the teams need their handoff wiring repaired. This is the first React-phase target AND a strong candidate for a real product fix (make adoption wire intra-team handoff from the connection graph, not best-effort from untyped template JSON).');
  return L.join('\n');
}

function main() {
  const pattern = arg('--pattern', 'SDLC —%');
  const db = openRead(MAIN_DB);
  const teams = db.prepare(`SELECT id, name FROM persona_teams WHERE name LIKE ? ORDER BY name`).all(pattern);
  if (!teams.length) {
    console.error(`No teams match LIKE ${JSON.stringify(pattern)}.`);
    process.exit(1);
  }
  const results = teams.map((t) => lintTeam(db, t));
  db.close();

  const outDir = join('docs', 'test', 'runs');
  mkdirSync(outDir, { recursive: true });
  const md = renderMarkdown(results);
  const mdPath = join(outDir, 'baseline-health.md');
  writeFileSync(mdPath, md + '\n', 'utf8');
  writeFileSync(join(outDir, 'baseline-health.json'), JSON.stringify(results, null, 2), 'utf8');

  // console summary
  for (const r of results) {
    console.log(`${r.verdict.padEnd(18)} ${r.team}  (blockers=${r.totalBlockers}, execs=${r.execCount})`);
  }
  console.log(`\nWrote ${mdPath}`);
  if (HAS('--json')) console.log(JSON.stringify(results, null, 2));
}

// Run as a CLI only when invoked directly (importable as a module otherwise).
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
