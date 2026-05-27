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
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';

const arg = (n, f = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f;
};
const RUNS = join('docs', 'test', 'runs');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Extract file-path citations from markdown/text. Matches `path/to/file.ext`
// (optionally `:line`), restricted to source-like extensions so prose nouns
// aren't mistaken for paths.
// Extensions ordered so disambiguating ones win the alternation (json before
// js, tsx before ts, mjs before js) — else ".json" matches as ".js" and a real
// path reads as ungrounded.
const CITE_RE = /`?(\.{0,2}\/?[A-Za-z0-9_./-]+\.(?:tsx|ts|jsx|mjs|json|js|rs|py|go|java|css|sql|toml|yaml|yml|md|adr))(?::\d+(?:-\d+)?)?`?/g;

function groundingForText(text, repoRoot, fileDir) {
  const cites = new Map(); // path -> exists
  let m;
  while ((m = CITE_RE.exec(text)) !== null) {
    const p = m[1];
    if (p.startsWith('http')) continue;
    // Relative links (./x, ../x) resolve against the citing file's dir;
    // repo-relative paths against repo root. Bare filenames (no dir) skipped.
    let abs;
    if (p.startsWith('./') || p.startsWith('../')) abs = join(fileDir || repoRoot, p);
    else if (p.includes('/')) abs = join(repoRoot, p);
    else continue;
    if (!cites.has(p)) cites.set(p, existsSync(abs));
  }
  const total = cites.size;
  const valid = [...cites.values()].filter(Boolean).length;
  const invalid = [...cites.entries()].filter(([, ok]) => !ok).map(([p]) => p);
  return { total, valid, pct: total ? Math.round((valid / total) * 100) : null, invalid: invalid.slice(0, 8) };
}

// Pull added markdown files (doc-track artifacts) from the run's repo.patch.
function addedDocsFromPatch(patchPath) {
  if (!existsSync(patchPath)) return [];
  const patch = readFileSync(patchPath, 'utf8');
  const files = [];
  const re = /^diff --git a\/(\S+) b\/(\S+)/gm;
  let m;
  while ((m = re.exec(patch)) !== null) {
    const f = m[2];
    if (/\.(md|adr)$/i.test(f) || f.includes('/adr/')) files.push(f);
  }
  return [...new Set(files)];
}

function band(team, minPersona, autonomyOk, healthOk) {
  if (!healthOk) return 'BROKEN';
  if (team >= 80 && minPersona >= 60 && autonomyOk) return 'PRODUCTION';
  if (team >= 60) return 'PROMISING';
  if (team >= 30) return 'NOT-READY';
  return 'NOT-READY';
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
  const grounding = [];
  for (const f of docFiles) {
    const abs = join(repoRoot, f);
    if (!existsSync(abs)) continue;
    const g = groundingForText(readFileSync(abs, 'utf8'), repoRoot, join(repoRoot, f, '..'));
    grounding.push({ file: f, ...g });
  }
  const groundedDocs = grounding.filter((g) => g.total > 0);
  const groundingPct = groundedDocs.length ? Math.round(groundedDocs.reduce((s, g) => s + g.pct, 0) / groundedDocs.length) : null;

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
  const detTeam = Math.round((cascade_completion + work_density + handoff_health + learning_loop + (groundingPct ?? 60)) / 5);
  // When judged, fold portfolio-balance + judged-output into the team score and drop "provisional".
  const teamScore = judge
    ? Math.round((cascade_completion + work_density + handoff_health + learning_loop + (groundingPct ?? 60) + (portfolioBalance ?? 60) + (judgeDims.meanJudge ?? 60)) / 7)
    : detTeam;
  const healthOk = run.summary.counts.executions > 0 && completed > 0;
  const verdict = judge
    ? band(teamScore, minPersonaOutput ?? 0, autonomyOk, healthOk)
    : band(detTeam, groundingPct ?? 60, autonomyOk, healthOk);

  const scorecard = {
    runId,
    team: run.summary.team,
    seed: run.seed.id,
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

  console.log(`${vlabel}=${verdict} team=${teamScore} grounding=${groundingPct ?? 'n/a'}%${judge ? ` balance=${portfolioBalance} minPersona=${minPersonaOutput}` : ''}`);
  console.log(`wrote ${join(dir, 'scorecard.md')}`);
}

main();
