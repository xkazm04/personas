// LONGITUDINAL — measure whether a team IMPROVES over repeated runs (the
// learning loop). Runs the SAME seed N times on a team; between iterations the
// repo is reset to a base (so the team faces the SAME task fresh) while MEMORY
// PERSISTS, and the run's reviews are resolved (feeding the human-feedback loop
// via the now-wired review→learned-memory synthesis). Emits a trajectory
// scorecard: does quality rise / cost fall / repeated work shrink as memory +
// prior-feedback accumulate?
//
// Usage:
//   node scripts/test/longitudinal.mjs --seed <id> --iterations 3 [--reset-repo] [--resolve approve|reject|none]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import * as bridge from './bridge.mjs';

import { argStrict as arg } from './lib/cli.mjs';
const has = (n) => process.argv.includes(n);
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const SEEDS = join('docs', 'tests', 'autonomy-eval', 'seeds');
const RUNS = join('docs', 'test', 'runs');

function loadSeed(id) {
  for (const f of readdirSync(SEEDS).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(SEEDS, f), 'utf8'));
    if (s.id === id || f === id || f === `${id}.json`) return s;
  }
  throw new Error(`seed not found: ${id}`);
}

// Read-only memory/version/review state for a team's personas.
function memState(personaIds, teamId) {
  const db = openRead(MAIN_DB);
  const ph = personaIds.map(() => '?').join(',');
  // L2 shared ledger (Phase 1): decisions/constraints now land in team_memories,
  // not per-persona — count them so the trajectory reflects shared-knowledge growth.
  let teamLedger = 0, teamDecisions = 0;
  if (teamId) {
    const t = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN category IN ('decision','constraint') THEN 1 ELSE 0 END) dc FROM team_memories WHERE team_id=?`).get(teamId);
    teamLedger = t.total || 0; teamDecisions = t.dc || 0;
  }
  const m = db.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN category='learned' THEN 1 ELSE 0 END) learned,
      SUM(CASE WHEN category='learned' AND tags LIKE '%human-review%' THEN 1 ELSE 0 END) from_reviews,
      COALESCE(SUM(access_count),0) access,
      SUM(CASE WHEN tier IN ('active','working') THEN 1 ELSE 0 END) active
    FROM persona_memories WHERE persona_id IN (${ph})`).get(...personaIds);
  const v = db.prepare(`SELECT COALESCE(MAX(version_number),0) maxv, COUNT(*) versions FROM persona_prompt_versions WHERE persona_id IN (${ph})`).get(...personaIds);
  const r = db.prepare(`SELECT
      SUM(CASE WHEN status IN ('approved','rejected') THEN 1 ELSE 0 END) resolved,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending
    FROM persona_manual_reviews WHERE persona_id IN (${ph})`).get(...personaIds);
  db.close();
  return { total: m.total || 0, learned: m.learned || 0, fromReviews: m.from_reviews || 0, access: m.access || 0, active: m.active || 0, maxVersion: v.maxv || 0, promptVersions: v.versions || 0, resolvedReviews: r.resolved || 0, pendingReviews: r.pending || 0, teamLedger, teamDecisions };
}

import { head as gitBase } from './lib/git.mjs';
function resetRepo(root, base) {
  try {
    // back to a clean base branch; drop dev-clone/* work-branches
    execFileSync('git', ['-C', root, 'checkout', '-f', 'main'], { encoding: 'utf8', stdio: 'ignore' });
    const branches = execFileSync('git', ['-C', root, 'branch', '--list', 'dev-clone/*'], { encoding: 'utf8' }).split('\n').map((s) => s.trim().replace(/^\*\s*/, '')).filter(Boolean);
    for (const b of branches) { try { execFileSync('git', ['-C', root, 'branch', '-D', b], { stdio: 'ignore' }); } catch {} }
    execFileSync('git', ['-C', root, 'worktree', 'prune'], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'reset', '--hard', base], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'clean', '-fd'], { stdio: 'ignore' });
    return true;
  } catch (e) { log('repo reset failed:', e.message); return false; }
}

function runOnce(seedId) {
  // Spawn the proven run lifecycle; capture the runId from its completion line.
  const out = execFileSync('node', ['scripts/test/run.mjs', '--seed', seedId, '--minutes', '35', '--quiescence', '150'],
    { encoding: 'utf8', timeout: 40 * 60 * 1000, env: { ...process.env } });
  const m = out.match(/RUN COMPLETE: (\S+)/);
  return m ? m[1] : null;
}

async function resolveReviews(personaIds, mode) {
  if (mode === 'none') return 0;
  const db = openRead(MAIN_DB);
  const ph = personaIds.map(() => '?').join(',');
  const pend = db.prepare(`SELECT id FROM persona_manual_reviews WHERE persona_id IN (${ph}) AND status='pending'`).all(...personaIds);
  db.close();
  const status = mode === 'reject' ? 'rejected' : 'approved';
  const note = mode === 'reject' ? 'Rejected by longitudinal policy — out of scope; prefer the established pattern.' : 'Approved by longitudinal policy — matches our conventions; keep this approach.';
  let n = 0;
  for (const r of pend) {
    try { await bridge.invoke('update_manual_review_status', { id: r.id, status, reviewerNotes: note }, { timeoutMs: 60000 }); n++; }
    catch { n++; /* large-return readback quirk; command succeeds */ }
  }
  return n;
}

function scoreOf(runId) {
  const sc = join(RUNS, runId, 'scorecard.json');
  if (!existsSync(sc)) return null;
  try { const j = JSON.parse(readFileSync(sc, 'utf8')); return { team: j.team_score ?? null, verdict: j.verdict ?? j.provisional_verdict ?? null }; } catch { return null; }
}
function costOf(runId) {
  const rj = join(RUNS, runId, 'run.json');
  try { const j = JSON.parse(readFileSync(rj, 'utf8')); return { cost: j.summary?.cost_usd ?? null, execs: j.summary?.counts?.executions ?? null }; } catch { return {}; }
}

async function main() {
  const seedId = arg('--seed');
  const iterations = parseInt(arg('--iterations', '3'), 10);
  const resolveMode = arg('--resolve', 'approve');
  const resetRepoFlag = has('--reset-repo');
  if (!seedId) { console.error('usage: node scripts/test/longitudinal.mjs --seed <id> --iterations N [--reset-repo] [--resolve approve|reject|none]'); process.exit(1); }

  const seed = loadSeed(seedId);
  const db = openRead(MAIN_DB);
  const info = teamInfo(db, seed.team);
  db.close();
  const personaIds = info.personaIds;
  const root = info.repo?.root;
  const base = root ? gitBase(root) : null;
  log(`Longitudinal: ${info.name} · seed ${seed.id} · ${iterations} iterations · reset-repo=${resetRepoFlag} · resolve=${resolveMode}`);
  log(`Base ref: ${base || '(no repo)'}`);

  const iters = [];
  for (let i = 1; i <= iterations; i++) {
    const pre = memState(personaIds, info.id);
    if (resetRepoFlag && root && base) { resetRepo(root, base); }
    log(`--- iteration ${i}/${iterations} --- (mem: learned=${pre.learned}, access=${pre.access}, fromReviews=${pre.fromReviews}, promptV=${pre.maxVersion})`);
    let runId = null;
    try { runId = runOnce(seed.id); } catch (e) { log(`iteration ${i} run errored: ${e.message}`); }
    // evaluate (deterministic; agent can judge later)
    if (runId) { try { execFileSync('node', ['scripts/test/evaluate.mjs', '--run', runId, '--no-build'], { encoding: 'utf8', timeout: 5 * 60 * 1000, env: { ...process.env } }); } catch {} }
    const resolved = await resolveReviews(personaIds, resolveMode);
    const post = memState(personaIds, info.id);
    const sc = runId ? scoreOf(runId) : null;
    const c = runId ? costOf(runId) : {};
    const it = {
      i, runId,
      cost: c.cost, execs: c.execs,
      team_score: sc?.team ?? null, verdict: sc?.verdict ?? null,
      reviewsResolved: resolved,
      mem_pre: pre, mem_post: post,
      delta: {
        learned: post.learned - pre.learned,
        access: post.access - pre.access,
        fromReviews: post.fromReviews - pre.fromReviews,
        promptVersion: post.maxVersion - pre.maxVersion,
      },
    };
    iters.push(it);
    log(`  iter ${i}: ${it.verdict || '?'} team=${it.team_score ?? '?'} cost=$${(it.cost ?? 0).toFixed?.(2) ?? it.cost} · Δlearned=${it.delta.learned} Δaccess=${it.delta.access} ΔfromReviews=${it.delta.fromReviews} ΔteamLedger=${(it.mem_post.teamLedger||0)-(it.mem_pre.teamLedger||0)} · resolved=${resolved}`);
  }

  // Trajectory analysis
  const scores = iters.map((x) => x.team_score).filter((x) => typeof x === 'number');
  const costs = iters.map((x) => x.cost).filter((x) => typeof x === 'number');
  const trend = (arr) => arr.length < 2 ? 'n/a' : (arr[arr.length - 1] > arr[0] ? 'rising' : arr[arr.length - 1] < arr[0] ? 'falling' : 'flat');
  const summary = {
    team: info.name, seed: seed.id, iterations, resolveMode, resetRepo: resetRepoFlag,
    quality_trend: trend(scores), cost_trend: trend(costs),
    memory_compounding: iters.length ? iters[iters.length - 1].mem_post.access - iters[0].mem_pre.access : 0,
    learned_growth: iters.length ? iters[iters.length - 1].mem_post.learned - iters[0].mem_pre.learned : 0,
    review_loop_converted: iters.reduce((a, x) => a + (x.delta.fromReviews || 0), 0),
    team_ledger_growth: iters.length ? (iters[iters.length-1].mem_post.teamLedger||0) - (iters[0].mem_pre.teamLedger||0) : 0,
    iterations_detail: iters,
  };
  const outPath = join(RUNS, `longitudinal-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${seed.id.replace(/[^a-z0-9]+/gi, '_')}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  log('—'.repeat(50));
  log(`LONGITUDINAL DONE: quality=${summary.quality_trend} cost=${summary.cost_trend} · memory access +${summary.memory_compounding} · learned +${summary.learned_growth} · review→learned ${summary.review_loop_converted}`);
  log(`scores: ${JSON.stringify(scores)}  costs: ${JSON.stringify(costs.map((c) => +c.toFixed(2)))}`);
  log(`wrote ${outPath}`);
}
main().catch((e) => { console.error('longitudinal fatal:', e); process.exit(1); });
