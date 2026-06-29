#!/usr/bin/env node
// Deliberation SOAK harness — drives a team deliberation hands-free against the
// running app's test-automation bridge (:17320), auto-confirming any capability
// approvals so the team can actually work, and recording flow/teamwork metrics
// for evaluation. Built for the "is the app ready for production?" soak.
//
// Prereq: the app must be running with the test-automation server, e.g.
//   npm run tauri:dev:test:full      (full features + test-automation on :17320)
//
// Usage:
//   node scripts/test/deliberation-soak.mjs                 # 4h on "ai-bookkeeper"
//   TEAM="ai-bookkeeper" MINUTES=240 SPLIT=1 node scripts/test/deliberation-soak.mjs
//
// It NEVER crashes the loop on a single call failure; everything is best-effort.

import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.PORT || 17320);
const TEAM = process.env.TEAM || 'ai-bookkeeper';
const MINUTES = Number(process.env.MINUTES || 240);
const POLL_MS = Number(process.env.POLL_MS || 4000);
const SPLIT = process.env.SPLIT !== '0'; // exercise parallel tracks by default
const OUT = process.env.OUT || `scripts/test/.soak/soak-${Date.now()}.jsonl`;

// A fixed multi-area question (TOPIC env) forces a rich agenda → reliable
// per-item splits; otherwise rotate the varied set below.
const FIXED_TOPIC = (process.env.TOPIC || '').trim();
// Rotated production-readiness questions so a 4h run gathers varied data.
const QUESTIONS = [
  'Is the app ready for production?',
  'What are the top blocking gaps before we can launch to real users?',
  'Is the security and data-handling posture production-ready?',
  'Can we commit to a launch date, and what must be fixed first?',
  'What is our single ship / no-ship verdict and the blocking vs. day-2 list?',
];
const ACTIVE = new Set(['open', 'converging', 'escalated', 'paused', 'awaiting_action', 'action_running', 'tracking']);
const TERMINAL = new Set(['resolved', 'aborted']);

const startedAt = Date.now();
const deadline = startedAt + MINUTES * 60_000;
let qi = 0;

const metrics = {
  startedAt: new Date(startedAt).toISOString(),
  team: TEAM,
  deliberations: 0,
  rounds: 0,
  actionsApproved: 0,
  actionsReaped: 0,
  escalations: 0,
  splits: 0,
  merges: 0,
  resolved: 0,
  aborted: 0,
  costUsd: 0,
  errors: 0,
  // Fix 5 — request→output yield (the efficiency signal): how many capability
  // requests (⏸) actually produced a usable result (🛠) vs. failed (⚠).
  turnRequests: 0,
  turnOutputs: 0,
  turnFailures: 0,
  perDeliberation: [],
};

function log(line) {
  const stamp = new Date().toISOString();
  const obj = typeof line === 'string' ? { msg: line } : line;
  // eslint-disable-next-line no-console
  console.log(`[${stamp}] ${typeof line === 'string' ? line : JSON.stringify(obj)}`);
  try {
    mkdirSync(dirname(OUT), { recursive: true });
    appendFileSync(OUT, JSON.stringify({ t: stamp, ...obj }) + '\n');
  } catch {
    /* best-effort */
  }
}

async function bridge(command, params = {}, timeoutSecs = 280) {
  // Client-side abort so a hung/asleep bridge can never wedge the loop forever
  // (the call then throws → call() catches → the loop re-checks the deadline).
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), (timeoutSecs + 25) * 1000);
  let text;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/bridge-exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'invokeCommand', params: { command, params }, timeout_secs: timeoutSecs }),
      signal: ctrl.signal,
    });
    text = await res.text();
  } finally {
    clearTimeout(to);
  }
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON from bridge: ${text.slice(0, 200)}`);
  }
  if (!env || env.success === false) throw new Error(env?.error || `bridge call ${command} failed`);
  return env.result;
}

const call = async (command, params, timeoutSecs) => {
  try {
    return await bridge(command, params, timeoutSecs);
  } catch (e) {
    metrics.errors++;
    log({ level: 'error', command, error: String(e).slice(0, 200) });
    return null;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tracksTerminal = (tracks) => tracks.length > 0 && tracks.every((t) => TERMINAL.has(t.status));

/** Drive ONE deliberation (or track) by exactly one step based on its status.
 *  Returns the (refetched) deliberation, or null. */
async function step(d, perDelib) {
  if (!d) return null;
  const id = d.id;
  switch (d.status) {
    case 'open':
    case 'converging': {
      // Split EARLY into per-item tracks so the team works the whole checklist in
      // parallel until each item hits a wall.
      if (SPLIT && !perDelib.didSplit && !d.parentId && d.round >= 1) {
        const agenda = (await call('list_deliberation_agenda', { deliberationId: id })) || [];
        if (agenda.filter((a) => a.status === 'open').length >= 2) {
          perDelib.didSplit = true;
          log({ event: 'split', deliberationId: id });
          const after = await call('split_team_deliberation', { deliberationId: id }, 180);
          if (after && after.status === 'tracking') metrics.splits++;
          return after || (await call('get_team_deliberation', { deliberationId: id }));
        }
      }
      const after = await call('advance_team_deliberation', { deliberationId: id }, 280);
      if (after) {
        metrics.rounds++;
        perDelib.rounds++;
      }
      return after || (await call('get_team_deliberation', { deliberationId: id }));
    }
    case 'awaiting_action': {
      log({ event: 'approve_action', deliberationId: id, action: d.pendingAction });
      metrics.actionsApproved++;
      perDelib.actions++;
      return await call('approve_deliberation_action', { deliberationId: id }, 280);
    }
    case 'action_running': {
      const after = await call('poll_deliberation_action', { deliberationId: id }, 60);
      if (after && after.status !== 'action_running') metrics.actionsReaped++;
      return after || d;
    }
    case 'escalated': {
      // First escalation → steer + resume; a second → wrap it up (no infinite loop).
      perDelib.escalations++;
      metrics.escalations++;
      const decision = perDelib.escalations >= 2 ? 'resolve' : 'resume';
      const comment =
        decision === 'resume'
          ? 'Use your best judgment and proceed; if a point is genuinely blocked, gather what data you can and converge.'
          : undefined;
      log({ event: 'escalation', deliberationId: id, decision });
      return await call('resolve_deliberation_escalation', { deliberationId: id, decision, comment: comment ?? null }, 180);
    }
    case 'tracking': {
      const tracks = (await call('list_deliberation_tracks', { deliberationId: id })) || [];
      if (tracksTerminal(tracks)) {
        log({ event: 'merge', deliberationId: id, tracks: tracks.length });
        const merged = await call('merge_deliberation_tracks', { deliberationId: id }, 220);
        if (merged) metrics.merges++;
        return merged || (await call('get_team_deliberation', { deliberationId: id }));
      }
      // Advance every non-terminal track CONCURRENTLY (true parallelism).
      const open = tracks.filter((t) => ACTIVE.has(t.status));
      await Promise.all(open.map((t) => step(t, perDelib.tracks[t.id] ||= freshPerDelib(t.id))));
      return await call('get_team_deliberation', { deliberationId: id });
    }
    default:
      return d;
  }
}

function freshPerDelib(id) {
  return { id, rounds: 0, actions: 0, escalations: 0, didSplit: false, tracks: {} };
}

/** The team's current active top-level deliberation, if any (the index allows
 *  only one), so the soak resumes rather than colliding on create. */
async function findActive() {
  const all = (await call('list_team_deliberations', { teamId: metrics.teamId })) || [];
  return all.find((d) => !d.parentId && ACTIVE.has(d.status)) || null;
}

async function runOneDeliberation(topic) {
  let d = await findActive();
  if (d) {
    log({ event: 'resumed', deliberationId: d.id, status: d.status });
  } else {
    d = await call('create_team_deliberation', {
      teamId: metrics.teamId,
      topic,
      goal: 'A single consolidated ship/no-ship verdict with blocking vs. non-blocking gaps.',
      createdBy: null,
      costBudgetUsd: null, // unlimited
    });
    if (!d) {
      await sleep(5000); // never tight-spin on a failed create
      return;
    }
    metrics.deliberations++;
    log({ event: 'created', deliberationId: d.id, topic });
  }
  const id = d.id;
  const perDelib = freshPerDelib(id);
  const tStart = Date.now();
  while (Date.now() < deadline && ACTIVE.has(d.status)) {
    d = (await step(d, perDelib)) || (await call('get_team_deliberation', { deliberationId: id }));
    if (!d) break;
    await sleep(POLL_MS);
  }
  // Final read for outcome + cost.
  const final = (await call('get_team_deliberation', { deliberationId: id })) || d;
  // Pull turns from the parent + any tracks for an honest output-yield count.
  const ids = [id];
  for (const t of (await call('list_deliberation_tracks', { deliberationId: id })) || []) ids.push(t.id);
  let turnsAll = [];
  let trackCost = 0;
  for (const tid of ids) turnsAll = turnsAll.concat((await call('list_deliberation_turns', { deliberationId: tid, limit: 500 })) || []);
  // Sum the tracks' own spend — they're separate deliberations, so the parent's
  // costSpentUsd alone undercounts a split deliberation's true cost.
  for (const tr of (await call('list_deliberation_tracks', { deliberationId: id })) || []) trackCost += tr.costSpentUsd || 0;
  const reqs = turnsAll.filter((t) => (t.body || '').startsWith('⏸')).length;
  const outs = turnsAll.filter((t) => (t.body || '').startsWith('🛠') && !/no output/.test(t.body)).length;
  const fails = turnsAll.filter((t) => (t.body || '').startsWith('⚠')).length;
  metrics.turnRequests += reqs;
  metrics.turnOutputs += outs;
  metrics.turnFailures += fails;
  const outcome = {
    id,
    topic,
    status: final?.status,
    rounds: perDelib.rounds,
    turns: turnsAll.length,
    requests: reqs,
    outputs: outs,
    failures: fails,
    actions: perDelib.actions,
    escalations: perDelib.escalations,
    didSplit: perDelib.didSplit,
    costUsd: round2((final?.costSpentUsd ?? 0) + trackCost),
    wallMin: round2((Date.now() - tStart) / 60_000),
  };
  metrics.costUsd = round2(metrics.costUsd + (final?.costSpentUsd ?? 0) + trackCost);
  if (final?.status === 'resolved') metrics.resolved++;
  if (final?.status === 'aborted') metrics.aborted++;
  metrics.perDeliberation.push(outcome);
  log({ event: 'deliberation_done', ...outcome });
}

const round2 = (n) => Math.round(n * 100) / 100;

function summary() {
  const elapsedMin = round2((Date.now() - startedAt) / 60_000);
  const s = {
    ...metrics,
    elapsedMin,
    avgRoundsToResolve:
      metrics.perDeliberation.length > 0
        ? round2(metrics.perDeliberation.reduce((a, b) => a + b.rounds, 0) / metrics.perDeliberation.length)
        : 0,
    // The headline efficiency metric: usable outputs ÷ capability requests.
    outputYield: metrics.turnRequests ? round2(metrics.turnOutputs / metrics.turnRequests) : 0,
    finishedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(OUT.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(s, null, 2));
  } catch {
    /* best-effort */
  }
  return s;
}

async function main() {
  // Health.
  try {
    const h = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    log(`Cannot reach the app's test bridge on :${PORT} — start it with 'npm run tauri:dev:test:full'. (${e})`);
    process.exit(1);
  }
  const teams = (await call('list_teams')) || [];
  const team = teams.find((t) => (t.name || '').toLowerCase().includes(TEAM.toLowerCase())) || teams.find((t) => t.id === TEAM);
  if (!team) {
    log(`No team matching "${TEAM}". Teams: ${teams.map((t) => t.name).join(', ')}`);
    process.exit(1);
  }
  metrics.teamId = team.id;
  metrics.teamName = team.name;
  log(`SOAK start — team "${team.name}" (${team.id}), ${MINUTES}m, split=${SPLIT}, out=${OUT}`);

  // Periodic heartbeat summary.
  const hb = setInterval(() => log({ event: 'heartbeat', ...summary() }), 60_000);

  // Hard wall-clock kill: fires at the deadline even if the loop is wedged on a
  // hung await (or the host slept and woke past the cap) — the backstop that the
  // overnight wave-2 run lacked. Writes the summary and exits.
  const hardKill = setTimeout(() => {
    const s = summary();
    log({ event: 'SOAK_HARD_STOP', ...s });
    // eslint-disable-next-line no-console
    console.log('\n=== SOAK SUMMARY (hard stop at deadline) ===\n' + JSON.stringify(s, null, 2));
    process.exit(0);
  }, Math.max(1000, deadline - Date.now()));

  while (Date.now() < deadline) {
    await runOneDeliberation(FIXED_TOPIC || QUESTIONS[qi++ % QUESTIONS.length]);
  }

  clearTimeout(hardKill);
  clearInterval(hb);
  const s = summary();
  log({ event: 'SOAK_COMPLETE', ...s });
  // eslint-disable-next-line no-console
  console.log('\n=== SOAK SUMMARY ===\n' + JSON.stringify(s, null, 2));
}

main().catch((e) => {
  log(`fatal: ${e}`);
  summary();
  process.exit(1);
});
