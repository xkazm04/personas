// Re-gather an existing run's bundle from current SQLite state. Use when a run
// quiesced before its cascade finished (e.g. premature quiescence under
// parallel load) — wait for the team to actually complete in the app, then
// re-gather to get the full executions/events/reviews/memories + repo.patch.
// The original run.json is preserved except its `summary` + repo-change facts,
// which are refreshed; evaluate.mjs recomputes dims from the JSON files anyway.
//
// Usage: node scripts/test/regather.mjs --run <runId>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import { gatherBundle } from './gather.mjs';

import { arg } from './lib/cli.mjs';
const RUNS = join('docs', 'test', 'runs');

import { head as gitHead, statusFingerprint as gitStatusFingerprint } from './lib/git.mjs';

const runId = arg('--run');
if (!runId) {
  console.error('usage: node scripts/test/regather.mjs --run <runId>');
  process.exit(1);
}
const dir = join(RUNS, runId);
const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
const db = openRead(MAIN_DB);
const info = teamInfo(db, run.seed.team);
db.close();

const summary = gatherBundle({
  runId,
  teamId: info.id,
  teamName: info.name,
  personaIds: info.personaIds,
  sinceIso: run.sinceIso,
  repo: info.repo,
  preRepoHead: run.repoHeadPre,
});

run.summary = summary;
run.regatheredAt = new Date().toISOString();
if (info.repo?.root) {
  const head = gitHead(info.repo.root);
  const status = gitStatusFingerprint(info.repo.root);
  run.repoHeadPost = head;
  run.repoChangedDuringRun = run.repoHeadPre !== head || status !== (run.repoStatusPre ?? status);
  run.repoCommittedDuringRun = run.repoHeadPre !== head;
}
writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');

console.log(`Re-gathered ${runId}:`);
console.log(`  executions: ${summary.counts.executions} (${JSON.stringify(summary.counts.executionsByStatus)}) across ${summary.counts.personasExecuted}/${info.members.length}`);
console.log(`  events: ${summary.counts.events} · reviews: ${summary.counts.reviews} · memories: ${summary.counts.memories} · cost: $${summary.cost_usd.toFixed(4)}`);
