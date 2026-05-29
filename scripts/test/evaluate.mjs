// EVALUATE layer — FIRST CUT, deterministic only (docs/test/evaluation-rubric.md).
// No LLM-judge yet (that's a follow-up, costs money per artifact). This scores
// the dimensions we can measure mechanically — crucially the GROUNDING GATE
// (do an artifact's cited file paths actually exist in the repo?), the single
// strongest guard against eloquent-but-ungrounded output — plus structural
// team dims. Produces scorecard.{json,md} in the run bundle.
//
// Usage: node scripts/test/evaluate.mjs --run <runId>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import { band, computeVerdict } from './lib/eval/verdict.mjs';
import { repoFileIndex, groundingForText, addedDocsFromPatch } from './lib/eval/grounding.mjs';
import { RUBRIC } from './lib/rubric.mjs';

/**
 * §1.A code-track deterministic check — run the repo's OWN build/lint/test and
 * record pass/fail. The strongest ungameable signal: eloquence can't fake a
 * green build. Runs on the repo's current (post-run, accumulated) state — a
 * team that leaves the repo unbuildable or tests failing is not production.
 * Each command is timeout-bounded; null command → 'na'.
 */
function runOne(cmd, repoRoot, timeoutMs) {
  try {
    execSync(cmd, { cwd: repoRoot, timeout: timeoutMs, stdio: 'pipe', encoding: 'utf8' });
    return { status: 'pass' };
  } catch (e) {
    const tail = (String(e.stdout || '').slice(-400) + String(e.stderr || '').slice(-400)).trim().slice(-500);
    return { status: e.signal === 'SIGTERM' || /ETIMEDOUT/.test(String(e)) ? 'timeout' : 'fail', tail };
  }
}
function runRepoChecks(repoRoot, cmds, timeoutMs = 240000) {
  const out = {};
  for (const key of ['build', 'lint', 'test']) {
    const cmd = cmds?.[key];
    if (!cmd) {
      out[key] = { status: 'na' };
      continue;
    }
    let r = runOne(cmd, repoRoot, timeoutMs);
    // Tests can be flaky (order-dependent / shared in-memory state). Retry a
    // failing TEST run once: pass-on-retry → 'flaky' (a real but softer signal —
    // caps at PROMISING, not NOT-READY); fail-twice → 'fail' (hard cap).
    if (key === 'test' && r.status === 'fail') {
      const r2 = runOne(cmd, repoRoot, timeoutMs);
      r = r2.status === 'pass' ? { status: 'flaky', tail: r.tail } : { status: 'fail', tail: r.tail };
    }
    out[key] = r;
  }
  return out;
}

import { arg } from './lib/cli.mjs';
const RUNS = join('docs', 'test', 'runs');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Grounding gate (CITE_RE, repoFileIndex, groundingForText) + doc-artifact
// discovery (addedDocsFromPatch) extracted to ./lib/eval/grounding.mjs.

// §1.A.1 Delivered Increment: did `master`/`main` ADVANCE during the run window
// with a real source increment (feature/fix/test) — not just a version bump or
// docs, and not left on a `dev-clone/*` branch? Merged-to-master is the bar:
// a branch nobody merged is indistinguishable from abandoned work over weeks.
function deliveredIncrement(repoRoot, baseHead) {
  if (!repoRoot || !baseHead) return { delivered: false, reason: 'no repo/base ref' };
  const git = (args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  try {
    const master = ['master', 'main'].map((b) => { try { return git(['rev-parse', '--verify', b]); } catch { return null; } }).find(Boolean);
    if (!master) return { delivered: false, reason: 'no master/main branch' };
    if (master === baseHead) return { delivered: false, reason: 'master did not advance (work likely on an un-merged dev-clone branch)' };
    const files = git(['diff', '--name-only', `${baseHead}..${master}`]).split('\n').map((s) => s.trim()).filter(Boolean);
    // a real increment = source/test files, excluding pure docs + version/changelog churn
    const sourceish = files.filter((f) =>
      /\.(ts|tsx|js|jsx|mjs|cjs|rs|py|go|java|rb|css|scss|sql|sh)$/i.test(f) &&
      !f.startsWith('docs/') &&
      !/(^|\/)(CHANGELOG|package-lock\.json|yarn\.lock|pnpm-lock)/i.test(f)
    );
    if (sourceish.length === 0) return { delivered: false, reason: 'master moved but no source increment (version/docs-only)', files: files.slice(0, 6) };
    return { delivered: true, masterHead: master, sourceFiles: sourceish.slice(0, 8) };
  } catch (e) {
    return { delivered: false, reason: 'git error: ' + e.message };
  }
}

function main() {
  const runId = arg('--run');
  if (!runId) {
    console.error('usage: node scripts/test/evaluate.mjs --run <runId>');
    process.exit(1);
  }
  const dir = join(RUNS, runId);
  const run = readJson(join(dir, 'run.json'));
  const executions = readJson(join(dir, 'executions.json'));
  const reviews = readJson(join(dir, 'reviews.json'));
  const memories = readJson(join(dir, 'memories.json'));
  const events = readJson(join(dir, 'events.json'));

  const db = openRead(MAIN_DB);
  const info = teamInfo(db, run.summary.team);
  db.close();
  const repoRoot = info.repo?.root;

  // --- deterministic structural dims ---
  const total = executions.length;
  const completed = executions.filter((e) => e.status === 'completed').length;
  const personasExecuted = new Set(executions.map((e) => e.persona_id)).size;
  const memberCount = info.members.length;
  const valueDelivered = executions.filter((e) => e.business_outcome === 'value_delivered').length;

  const cascade_completion = Math.round((personasExecuted / memberCount) * 100); // did work reach every member?
  const work_density = total ? Math.round((completed / total) * 100) : 0; // completed vs total (retries/noops drag)
  const eventsDelivered = events.filter((e) => e.status === 'delivered').length;
  const handoff_health = events.length ? Math.round((eventsDelivered / events.length) * 100) : 0;
  const learning_loop = (reviews.length > 0 ? 50 : 0) + (memories.filter((m) => m.category === 'learned').length > 0 ? 50 : 0);

  // --- grounding gate (doc-track artifacts) ---
  const docFiles = repoRoot ? addedDocsFromPatch(join(dir, 'repo.patch')) : [];
  const repoFiles = repoFileIndex(repoRoot);
  const grounding = [];
  for (const f of docFiles) {
    const abs = join(repoRoot, f);
    if (!existsSync(abs)) continue;
    const g = groundingForText(readFileSync(abs, 'utf8'), repoRoot, join(repoRoot, f, '..'), repoFiles);
    grounding.push({ file: f, ...g });
  }
  const groundedDocs = grounding.filter((g) => g.total > 0);
  const groundingPct = groundedDocs.length ? Math.round(groundedDocs.reduce((s, g) => s + g.pct, 0) / groundedDocs.length) : null;

  // --- §1.A code-track checks (run the repo's own build/lint/test) ---
  const isCodeTrack = Array.isArray(run.seed?.tracks) && run.seed.tracks.includes('code');
  const skipChecks = process.argv.includes('--no-build');
  let codeTrack = null;
  if (isCodeTrack && repoRoot && run.seed?.repo_cmds && !skipChecks) {
    codeTrack = runRepoChecks(repoRoot, run.seed.repo_cmds);
  }
  const codeTrackFailed = codeTrack && Object.values(codeTrack).some((c) => c.status === 'fail');

  // --- autonomy cost (this topology: reviews left pending = leaning on a human) ---
  const pendingReviews = reviews.filter((r) => r.status === 'pending').length;
  const autonomy_interventions = run.summary.counts.approvals + pendingReviews; // approvals auto-handled + reviews awaiting human
  const autonomyOk = true; // no orchestrator interventions were needed to keep the cascade moving in this run

  // --- judge merge (§7) — read judge.json if the agent-judge has scored it ---
  const judgePath = join(dir, 'judge.json');
  const judge = existsSync(judgePath) ? readJson(judgePath) : null;
  let judgeDims = null;
  let portfolioBalance = null;
  let minPersonaOutput = null;
  if (judge) {
    const personas = judge.personas || [];
    // per-persona output grade = min(grounding floor, mean of judge dims)
    const grades = personas.map((p) => {
      const d = p.dims || {};
      const vals = ['correctness', 'actionability', 'specificity', 'role_fidelity'].map((k) => d[k]).filter((v) => typeof v === 'number');
      const mean = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      return Math.min(mean, groundingPct ?? 100);
    });
    minPersonaOutput = grades.length ? Math.min(...grades) : null;
    const meanJudge = grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null;
    portfolioBalance = judge.portfolio_balance?.score ?? null;
    judgeDims = { perPersonaGrades: grades, minPersonaOutput, meanJudge, portfolioBalance };
  }

  // --- roll-up ---
  const detTeam = Math.round((cascade_completion + work_density + handoff_health + learning_loop + (groundingPct ?? RUBRIC.fallbackScore)) / RUBRIC.rollup.deterministicDivisor);
  // When judged, fold portfolio-balance + judged-output into the team score and drop "provisional".
  const teamScore = judge
    ? Math.round((cascade_completion + work_density + handoff_health + learning_loop + (groundingPct ?? RUBRIC.fallbackScore) + (portfolioBalance ?? RUBRIC.fallbackScore) + (judgeDims.meanJudge ?? RUBRIC.fallbackScore)) / RUBRIC.rollup.judgedDivisor)
    : detTeam;
  const healthOk = run.summary.counts.executions > 0 && completed > 0;
  // Cascade-stall cap: a run where not every member executed, or any execution
  // FAILED, did not close its goal — it cannot exceed NOT-READY no matter how
  // good the work that DID run (rubric §0/§2 goal-closure). Run-2 finding: a
  // single failed execution (engine panic) stalled the success-gated chain.
  const failedExecs = total - completed;
  const cascadeStalled = personasExecuted < memberCount || failedExecs > 0;
  const base = judge
    ? band(teamScore, minPersonaOutput ?? 0, autonomyOk, healthOk)
    : band(detTeam, groundingPct ?? RUBRIC.fallbackScore, autonomyOk, healthOk);
  // §1.A.1 Delivered Increment gate: a code-track run that ships NOTHING to
  // master (all work on un-merged branches, or master moved by version/docs only)
  // cannot be PRODUCTION — the deliverable is the point. Doc-track seeds are
  // exempt (their deliverable is the grounded document).
  const increment = isCodeTrack ? deliveredIncrement(repoRoot, run.repoHeadPre) : { delivered: true, reason: 'doc-track exempt' };
  // §1.A.2 Self-veto: any execution in a code-track run that completed with
  // business_outcome=`precondition_failed` is the team telling us — in its own
  // words — that the run is NOT ready to ship (release manager refusing to bless
  // a red trunk; engineer refusing to implement against a broken precondition).
  const selfVeto = isCodeTrack && executions.some((e) => e.business_outcome === 'precondition_failed');
  // The five rubric caps collapsed into ONE ordered fold (see lib/eval/verdict.mjs).
  // Each lowers the verdict to at most its `to`; the fold is order-independent
  // (cap is min-by-rank) but ordered to mirror the rubric narrative.
  const verdict = computeVerdict(base, [
    // Cascade stall (§0/§2 goal-closure): not every member ran, or an execution
    // FAILED → the goal didn't close, no matter how good the work that did run.
    { when: cascadeStalled, to: 'NOT-READY' },
    // §1.A: a code-track run that leaves build OR tests FAILING is not production
    // (the strongest ungameable gate). lint fail is a WARN, not a cap.
    { when: !!(codeTrack && (codeTrack.build?.status === 'fail' || codeTrack.test?.status === 'fail')), to: 'NOT-READY' },
    // §1.A: a flaky test suite (passed only on retry) is a softer concern → PROMISING.
    { when: !!(codeTrack && codeTrack.test?.status === 'flaky'), to: 'PROMISING' },
    // §1.A.1: code-track shipped nothing to master → NOT-READY.
    { when: isCodeTrack && !increment.delivered, to: 'NOT-READY' },
    // §1.A.2: the team self-vetoed; its own quality bar outranks the dims → PROMISING.
    { when: selfVeto, to: 'PROMISING' },
  ]);

  const scorecard = {
    runId,
    team: run.summary.team,
    seed: run.seed.id,
    code_track: codeTrack,
    delivered_increment: increment,
    self_veto: selfVeto ? {
      capped: 'PROMISING',
      executions: executions.filter((e) => e.business_outcome === 'precondition_failed').map((e) => ({ id: e.id, persona_id: e.persona_id })),
    } : null,
    rubric_version: judge ? '1-judged' : '1-deterministic',
    note: judge
      ? 'Judged scorecard (deterministic + agent-judge §1.B + portfolio balance §2.1). Still requires 3 consecutive PRODUCTION on held-out seeds + decay analysis to CERTIFY.'
      : 'FIRST-CUT deterministic scorecard. Correctness / actionability / role-fidelity (judge §1.B) + portfolio balance (§2.1) NOT yet scored — verdict is provisional.',
    deterministic_dims: {
      cascade_completion,
      work_density,
      handoff_health,
      learning_loop,
      grounding_pct: groundingPct,
    },
    judge: judge ? { dims: judgeDims, portfolio_balance: judge.portfolio_balance, personas: judge.personas, judge_notes: judge.judge_notes } : null,
    team_score: teamScore,
    [judge ? 'verdict' : 'provisional_verdict']: verdict,
    facts: {
      executions: total,
      completed,
      failed: failedExecs,
      cascade_stalled: cascadeStalled,
      value_delivered: valueDelivered,
      personasExecuted,
      memberCount,
      eventsDelivered,
      reviews: reviews.length,
      pendingReviews,
      learnedMemories: memories.filter((m) => m.category === 'learned').length,
      cost_usd: run.summary.cost_usd,
      repoChanged: run.repoChangedDuringRun,
    },
    grounding,
    autonomy: { interventions: autonomy_interventions, pendingReviews, note: 'pending reviews = work awaiting a human; the orchestration layer (P3) would auto-resolve per policy' },
  };
  writeFileSync(join(dir, 'scorecard.json'), JSON.stringify(scorecard, null, 2), 'utf8');

  const L = [];
  const vlabel = judge ? 'verdict' : 'provisional verdict';
  L.push(`# Scorecard (${judge ? 'judged' : 'deterministic, provisional'}) — ${runId}`);
  L.push('');
  L.push(`**Team:** ${scorecard.team} · **Seed:** ${scorecard.seed} · **${judge ? 'Verdict' : 'Provisional verdict'}:** \`${verdict}\` · **team score:** ${teamScore}`);
  L.push('');
  L.push(`> ${scorecard.note}`);
  L.push('');
  L.push('## Deterministic dimensions');
  L.push('| Dim | Score | Basis |');
  L.push('|---|---|---|');
  L.push(`| Cascade completion | ${cascade_completion} | ${personasExecuted}/${memberCount} members executed |`);
  L.push(`| Work density | ${work_density} | ${completed}/${total} executions completed (no retries/noops) |`);
  L.push(`| Handoff health | ${handoff_health} | ${eventsDelivered}/${events.length} events delivered |`);
  L.push(`| Learning loop | ${learning_loop} | ${reviews.length} reviews + ${scorecard.facts.learnedMemories} learned memories |`);
  L.push(`| **Grounding gate** | ${groundingPct ?? 'n/a'} | cited file paths that actually exist, across ${groundedDocs.length} doc artifacts |`);
  if (codeTrack) {
    L.push(`| **Code-track §1.A** | ${codeTrackFailed ? 'FAIL' : 'ok'} | build=${codeTrack.build.status} · lint=${codeTrack.lint.status} · test=${codeTrack.test.status} (repo's own commands on post-run state) |`);
  }
  if (judge) {
    L.push('');
    L.push('## Judge dimensions (agent-judge §1.B + §2.1)');
    L.push(`- **Per-persona output grades:** ${JSON.stringify(judgeDims.perPersonaGrades)} (min ${judgeDims.minPersonaOutput})`);
    L.push(`- **Portfolio balance:** ${portfolioBalance} — ${judge.portfolio_balance?.note || ''}`);
    L.push(`- **Work taxonomy:** ${JSON.stringify(judge.portfolio_balance?.labels_histogram || {})}`);
    for (const p of judge.personas || []) {
      L.push(`  - **${p.role}** (${(p.work_labels || []).join(',')}): ${JSON.stringify(p.dims)}${p.evidence?.[0] ? ` — _"${String(p.evidence[0]).slice(0, 120)}"_` : ''}`);
    }
    if (judge.judge_notes) L.push(`- **Judge notes:** ${judge.judge_notes}`);
  }
  L.push('');
  L.push('## Grounding detail (the anti-eloquence gate)');
  for (const g of grounding) {
    L.push(`- \`${g.file}\` — ${g.valid}/${g.total} cited paths exist (${g.pct ?? 'n/a'}%)${g.invalid.length ? ` · unresolved: ${g.invalid.join(', ')}` : ''}`);
  }
  L.push('');
  L.push('## Facts');
  L.push('```json');
  L.push(JSON.stringify(scorecard.facts, null, 2));
  L.push('```');
  if (!judge) {
    L.push('');
    L.push('## Not yet scored (needs agent-judge, §1.B + §2.1)');
    L.push('- Correctness, actionability, specificity, role-fidelity per artifact; portfolio balance.');
    L.push('- Run `node scripts/test/judge-packet.mjs --run <id>`, judge in-conversation, write `judge.json`, re-run evaluate. The deterministic verdict is a floor, not the final grade.');
  } else {
    L.push('');
    L.push('## To CERTIFY (not yet)');
    L.push('- Needs **3 consecutive PRODUCTION** runs on **held-out** seeds + decay analysis (§3). One judged run is necessary, not sufficient.');
  }
  writeFileSync(join(dir, 'scorecard.md'), L.join('\n') + '\n', 'utf8');

  console.log(`${vlabel}=${verdict} team=${teamScore} grounding=${groundingPct ?? 'n/a'}%${judge ? ` balance=${portfolioBalance} minPersona=${minPersonaOutput}` : ''}${codeTrack ? ` code[build=${codeTrack.build.status},lint=${codeTrack.lint.status},test=${codeTrack.test.status}]` : ''}${isCodeTrack ? ` delivered=${increment.delivered}${increment.delivered ? '' : ' (' + increment.reason + ')'}` : ''}`);
  console.log(`wrote ${join(dir, 'scorecard.md')}`);
}

main();
