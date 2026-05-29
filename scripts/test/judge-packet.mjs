// Assemble a per-run JUDGE PACKET — the artifacts the agent-judge (§7) reads
// in-conversation to score §1.B dims (correctness/actionability/specificity/
// role-fidelity) + the §2.1 work-taxonomy/portfolio-balance labels. The judge
// then writes docs/test/runs/<run>/judge.json, which evaluate.mjs merges into
// the final (non-provisional) verdict.
//
// Usage: node scripts/test/judge-packet.mjs --run <runId>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openRead, MAIN_DB, tryJson } from './db.mjs';
import { teamInfo } from './model.mjs';

import { arg } from './lib/cli.mjs';
const RUNS = join('docs', 'test', 'runs');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clip = (s, n) => (s == null ? '' : String(s).length > n ? String(s).slice(0, n) + `\n…[+${String(s).length - n} chars]` : String(s));

function outputText(e) {
  const o = tryJson(e.output_data);
  if (o && typeof o === 'object') return o.text || o.reply || o.output || o.summary || JSON.stringify(o);
  return e.output_data || '';
}

function main() {
  const runId = arg('--run');
  if (!runId) {
    console.error('usage: node scripts/test/judge-packet.mjs --run <runId>');
    process.exit(1);
  }
  const dir = join(RUNS, runId);
  const run = readJson(join(dir, 'run.json'));
  const executions = readJson(join(dir, 'executions.json'));
  const reviews = readJson(join(dir, 'reviews.json'));
  const memories = readJson(join(dir, 'memories.json'));
  const scorecard = existsSync(join(dir, 'scorecard.json')) ? readJson(join(dir, 'scorecard.json')) : null;

  const db = openRead(MAIN_DB);
  const info = teamInfo(db, run.summary.team);
  db.close();
  const nameOf = (pid) => info.members.find((m) => m.persona_id === pid)?.name || pid.slice(0, 8);

  console.log(`# JUDGE PACKET — ${runId}`);
  console.log(`Team: ${run.summary.team} · Seed: ${run.seed.id} (${(run.seed.tracks || []).join('+')})`);
  console.log(`Goal: ${run.seed.goal}`);
  console.log(`\nGrounding (mechanical, inherited): ${JSON.stringify((scorecard?.grounding || []).map((g) => `${g.file}=${g.pct}%`))}`);
  console.log(`\n## Per-persona artifacts (score correctness/actionability/specificity/role_fidelity + work labels)\n`);
  for (const e of executions) {
    console.log(`### ${nameOf(e.persona_id)}  [${e.status} · ${e.business_outcome || '-'} · $${(e.cost_usd || 0).toFixed(2)}]`);
    console.log(`persona_id: ${e.persona_id}`);
    console.log('OUTPUT:');
    console.log(clip(outputText(e), 2200));
    console.log('');
  }
  if (reviews.length) {
    console.log('## Reviews created (verdicts the team produced)');
    for (const r of reviews) console.log(`- [${r.severity}] ${r.title}\n  ${clip(r.description, 400)}`);
    console.log('');
  }
  if (memories.length) {
    console.log('## Memories created (what the team learned)');
    for (const m of memories) console.log(`- [${m.category}/imp${m.importance}] ${m.title}: ${clip(m.content, 200)}`);
    console.log('');
  }
  console.log('## Repo artifacts (for work-taxonomy classification)');
  console.log(`repo.patch present: ${existsSync(join(dir, 'repo.patch'))} · repoChanged: ${run.repoChangedDuringRun}`);
  console.log('(read docs/test/runs/' + runId + '/repo.patch for the diff + new untracked files)');
}

main();
