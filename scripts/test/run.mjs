// RUN layer (docs/test/run-protocol.md §2) — arrange + start + sustain a team
// on a seed goal, then gather an immutable bundle. Drives the LIVE app via the
// bridge; verifies via SQLite. No scoring (that's P4).
//
// Usage:
//   node scripts/test/run.mjs --seed ai-paralegal/citation-validator-adr [--minutes 20] [--quiescence 90]
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import { lintTeam } from './health-lint.mjs';
import { gatherBundle } from './gather.mjs';
import * as bridge from './bridge.mjs';

import { argStrict as arg } from './lib/cli.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

const SEEDS_DIR = join('docs', 'test', 'seeds');

function loadSeed(idOrFile) {
  const files = readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(SEEDS_DIR, f), 'utf8'));
    if (s.id === idOrFile || f === idOrFile || f === `${idOrFile}.json`) return s;
  }
  throw new Error(`seed not found: ${idOrFile} (have: ${files.join(', ')})`);
}

function configHash(db, personaIds) {
  const h = crypto.createHash('sha256');
  for (const pid of personaIds.slice().sort()) {
    const p = db.prepare(`SELECT structured_prompt, design_context FROM personas WHERE id=?`).get(pid);
    const trigs = db.prepare(`SELECT trigger_type, config, enabled, status FROM persona_triggers WHERE persona_id=? ORDER BY id`).all(pid);
    const subs = db.prepare(`SELECT event_type, enabled FROM persona_event_subscriptions WHERE persona_id=? ORDER BY id`).all(pid);
    h.update(JSON.stringify({ pid, p, trigs, subs }));
  }
  return h.digest('hex').slice(0, 16);
}

function gitHead(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
function gitDirty(root) {
  try {
    return execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return null;
  }
}
// Fingerprint the working tree (tracked + untracked) so we detect changes a
// run made even when it didn't COMMIT (HEAD unchanged). Run-2/3 finding:
// HEAD-only detection reported "repo changed: false" while the team had
// modified src files + added tests in the working tree.
function gitStatusFingerprint(root) {
  try {
    return execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const seedId = arg('--seed');
  if (!seedId) {
    console.error('usage: node scripts/test/run.mjs --seed <seedId> [--minutes N] [--quiescence S]');
    process.exit(1);
  }
  const windowMin = parseInt(arg('--minutes', '20'), 10);
  const quiescenceMs = parseInt(arg('--quiescence', '90'), 10) * 1000;
  const seed = loadSeed(seedId);
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${seed.id.replace(/[^a-z0-9]+/gi, '_')}`;

  // health
  const hc = await bridge.health();
  if (hc !== 200) {
    console.error(`bridge not healthy (status ${hc}) — is the app running on ${process.env.PERSONAS_BASE || ':17321'}? aborting.`);
    process.exit(2);
  }

  const db = openRead(MAIN_DB);
  const info = teamInfo(db, seed.team);
  log(`Team: ${info.name} (${info.members.length} members) · entry: ${info.entryMembers.map((m) => m.name).join(', ') || 'NONE'} · repo: ${info.repo?.name || '—'}`);

  // PRE-FLIGHT health gate
  const lint = lintTeam(db, { id: info.id, name: info.name });
  log(`Pre-flight lint: ${lint.verdict} (blockers=${lint.totalBlockers})`);
  const outDir = join('docs', 'test', 'runs', runId);
  mkdirSync(outDir, { recursive: true });
  if (lint.verdict === 'CANNOT-CASCADE' || lint.totalBlockers > 0) {
    writeFileSync(join(outDir, 'run.json'), JSON.stringify({ runId, seed, verdict: 'BROKEN', reason: 'pre-flight health gate failed', lint }, null, 2));
    console.error(`ABORT: team failed pre-flight gate (${lint.verdict}). Wrote ${outDir}/run.json. Fix wiring before running.`);
    db.close();
    process.exit(3);
  }
  if (info.entryPersonaIds.length === 0) {
    console.error('ABORT: no entry persona (every member is targeted by a non-feedback edge).');
    db.close();
    process.exit(3);
  }

  const cfgHash = configHash(db, info.personaIds);
  const repoHeadPre = info.repo?.root ? gitHead(info.repo.root) : null;
  const repoDirtyPre = info.repo?.root ? gitDirty(info.repo.root) : null;
  const repoStatusPre = info.repo?.root ? gitStatusFingerprint(info.repo.root) : null;
  const sinceIso = new Date(Date.now() - 60000).toISOString(); // 60s back: safely before the kick
  db.close();

  const entryId = info.entryPersonaIds[0];
  const entryName = info.entryMembers[0]?.name;
  log(`Seeding entry persona "${entryName}" with goal (${seed.id})…`);

  const startedAt = nowIso();
  // KICK: run the entry persona with the goal as input. execute_persona may
  // block until the entry execution completes (minutes); generous timeout, and
  // we proceed to poll regardless so a long entry turn doesn't lose the run.
  let kickResult = null;
  try {
    // Tauri maps camelCase JS keys → snake_case Rust params (execute_persona
    // takes persona_id/input_data; the bridge calls it as personaId/inputData).
    kickResult = await bridge.invoke('execute_persona', { personaId: entryId, inputData: JSON.stringify({ request: seed.goal, _seed: seed.id }) }, { timeoutMs: 9 * 60 * 1000, pollMs: 3000 });
    log(`Entry execution returned: status=${kickResult?.status ?? '?'} id=${(kickResult?.id || '').slice(0, 8)}`);
  } catch (e) {
    log(`Entry kick did not return cleanly (${e.message}) — proceeding to poll for the cascade anyway.`);
  }

  // SUSTAIN: poll executions until quiescence or window timeout.
  const deadline = Date.now() + windowMin * 60 * 1000;
  let lastCount = -1;
  let lastChangeAt = Date.now();
  const heartbeat = [];
  while (Date.now() < deadline) {
    const db2 = openRead(MAIN_DB);
    const ph = info.personaIds.map(() => '?').join(',');
    const rows = db2
      .prepare(`SELECT status, persona_id FROM persona_executions WHERE persona_id IN (${ph}) AND created_at >= ? `)
      .all(...info.personaIds, sinceIso);
    // "Owed handoffs": a delivered/pending team_handoff event targeting a team
    // member that has NOT yet executed in this run window. This means a role's
    // work is in-flight (handoff fired, target not yet spawned) — we must NOT
    // quiesce, even through a brief running===0 gap. Runs 6-8 + the immigration
    // parallel run quiesced at 2/5 because the handoff→spawn latency (worse
    // under concurrent load) exceeded the no-change window while running===0.
    const executedSet = new Set(rows.map((r) => r.persona_id));
    const owedHandoffs = db2
      .prepare(
        `SELECT DISTINCT target_persona_id FROM persona_events
         WHERE target_persona_id IN (${ph}) AND event_type LIKE 'team_handoff.%'
           AND status IN ('delivered','pending') AND created_at >= ?`
      )
      .all(...info.personaIds, sinceIso)
      .filter((e) => e.target_persona_id && !executedSet.has(e.target_persona_id)).length;
    db2.close();
    const running = rows.filter((r) => r.status === 'running' || r.status === 'queued').length;
    const count = rows.length;
    const distinct = new Set(rows.map((r) => r.persona_id)).size;
    heartbeat.push({ t: nowIso(), execs: count, running, distinctPersonas: distinct, owedHandoffs });
    if (count !== lastCount) {
      lastCount = count;
      lastChangeAt = Date.now();
      log(`  …executions=${count} (running=${running}, personas=${distinct}/${info.members.length}${owedHandoffs ? `, owed handoffs=${owedHandoffs}` : ''})`);
    }
    // Quiescent: ≥1 execution happened, none running, no handoff owed to an
    // un-executed member, and nothing new for the quiescence window.
    if (count > 0 && running === 0 && owedHandoffs === 0 && Date.now() - lastChangeAt >= quiescenceMs) {
      log(`Quiescent (${Math.round(quiescenceMs / 1000)}s no change, none running, no owed handoffs) — ending run.`);
      break;
    }
    if (owedHandoffs > 0) lastChangeAt = Date.now(); // a handoff is in-flight → keep the window open
    await sleep(15000);
  }
  if (Date.now() >= deadline) log(`Window timeout (${windowMin}m) reached.`);

  // GATHER
  const db3 = openRead(MAIN_DB);
  const summary = gatherBundle({
    runId,
    teamId: info.id,
    teamName: info.name,
    personaIds: info.personaIds,
    sinceIso,
    repo: info.repo,
    preRepoHead: repoHeadPre,
  });
  // verify config_hash unchanged (no mid-run human edits)
  const cfgHashPost = configHash(db3, info.personaIds);
  const repoHeadPost = info.repo?.root ? gitHead(info.repo.root) : null;
  const repoStatusPost = info.repo?.root ? gitStatusFingerprint(info.repo.root) : null;
  db3.close();

  const runMeta = {
    runId,
    seed,
    startedAt,
    endedAt: nowIso(),
    windowMin,
    sinceIso,
    entry: { personaId: entryId, name: entryName },
    configHashPre: cfgHash,
    configHashPost: cfgHashPost,
    configUnchanged: cfgHash === cfgHashPost,
    repoHeadPre,
    repoHeadPost,
    repoDirtyPre,
    repoChangedDuringRun: repoHeadPre !== repoHeadPost || repoStatusPre !== repoStatusPost,
    repoCommittedDuringRun: repoHeadPre !== repoHeadPost,
    kickReturned: !!kickResult,
    heartbeat,
    summary,
  };
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(runMeta, null, 2), 'utf8');

  log('—'.repeat(50));
  log(`RUN COMPLETE: ${runId}`);
  log(`  executions: ${summary.counts.executions} (${JSON.stringify(summary.counts.executionsByStatus)}) across ${summary.counts.personasExecuted}/${info.members.length} personas`);
  log(`  events: ${summary.counts.events} (${JSON.stringify(summary.counts.eventsByStatus)}) · reviews: ${summary.counts.reviews} · memories: ${summary.counts.memories} · approvals: ${summary.counts.approvals}`);
  log(`  cost: $${summary.cost_usd.toFixed(4)} · repo changed: ${runMeta.repoChangedDuringRun} · config unchanged: ${runMeta.configUnchanged}`);
  log(`  bundle: ${outDir}`);
}

main().catch((e) => {
  console.error('run.mjs fatal:', e);
  process.exit(1);
});
