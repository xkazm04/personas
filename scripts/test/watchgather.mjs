// Watch an already-running team cascade to quiescence (handoff-aware) and
// gather its bundle — WITHOUT re-kicking. Use when the kick already happened
// (e.g. a harness was orphaned) but the app-side cascade is still progressing.
//
// Usage: node scripts/test/watchgather.mjs --seed <seedId> --since <ISO> [--minutes N] [--quiescence S]
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import { gatherBundle } from './gather.mjs';

import { arg } from './lib/cli.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const SEEDS_DIR = join('docs', 'test', 'seeds');

function loadSeed(id) {
  for (const f of readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(SEEDS_DIR, f), 'utf8'));
    if (s.id === id || f === id || f === `${id}.json`) return s;
  }
  throw new Error(`seed not found: ${id}`);
}
import { head as gitHead } from './lib/git.mjs';

const seed = loadSeed(arg('--seed'));
const sinceIso = arg('--since');
const windowMin = parseInt(arg('--minutes', '30'), 10);
const quiescenceMs = parseInt(arg('--quiescence', '150'), 10) * 1000;
const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${seed.id.replace(/[^a-z0-9]+/gi, '_')}`;

const db = openRead(MAIN_DB);
const info = teamInfo(db, seed.team);
db.close();
log(`Watching: ${info.name} (${info.members.length}) repo=${info.repo?.name} since=${sinceIso}`);
const repoHeadPre = info.repo?.root ? gitHead(info.repo.root) : null;

const deadline = Date.now() + windowMin * 60 * 1000;
let lastCount = -1, lastChangeAt = Date.now();
while (Date.now() < deadline) {
  const db2 = openRead(MAIN_DB);
  const ph = info.personaIds.map(() => '?').join(',');
  const rows = db2.prepare(`SELECT status, persona_id FROM persona_executions WHERE persona_id IN (${ph}) AND created_at >= ?`).all(...info.personaIds, sinceIso);
  const executed = new Set(rows.map((r) => r.persona_id));
  const owed = db2.prepare(`SELECT DISTINCT target_persona_id FROM persona_events WHERE target_persona_id IN (${ph}) AND event_type LIKE 'team_handoff.%' AND status IN ('delivered','pending') AND created_at >= ?`).all(...info.personaIds, sinceIso).filter((e) => e.target_persona_id && !executed.has(e.target_persona_id)).length;
  db2.close();
  const running = rows.filter((r) => r.status === 'running' || r.status === 'queued').length;
  const count = rows.length;
  if (count !== lastCount) { lastCount = count; lastChangeAt = Date.now(); log(`  execs=${count} (running=${running}, personas=${new Set(rows.map(r=>r.persona_id)).size}/${info.members.length}${owed ? `, owed=${owed}` : ''})`); }
  if (count > 0 && running === 0 && owed === 0 && Date.now() - lastChangeAt >= quiescenceMs) { log('Quiescent — gathering.'); break; }
  if (owed > 0) lastChangeAt = Date.now();
  await sleep(15000);
}

const outDir = join('docs', 'test', 'runs', runId);
mkdirSync(outDir, { recursive: true });
const summary = gatherBundle({ runId, teamId: info.id, teamName: info.name, personaIds: info.personaIds, sinceIso, repo: info.repo, preRepoHead: repoHeadPre });
const repoHeadPost = info.repo?.root ? gitHead(info.repo.root) : null;
writeFileSync(join(outDir, 'run.json'), JSON.stringify({ runId, seed, sinceIso, repoHeadPre, repoHeadPost, repoChangedDuringRun: repoHeadPre !== repoHeadPost || true, summary, watchedNotKicked: true }, null, 2), 'utf8');
log(`GATHERED ${runId}: execs=${summary.counts.executions} ${JSON.stringify(summary.counts.executionsByStatus)} across ${summary.counts.personasExecuted}/${info.members.length} · reviews=${summary.counts.reviews} · cost=$${summary.cost_usd.toFixed(4)}`);
log(`bundle: ${outDir}`);
