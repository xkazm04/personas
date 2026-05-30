// C2 CHAOS driver — proves the DURABLE EXECUTION QUEUE survives an app restart
// (P1a engine/mod.rs requeue_persisted_executions + recover_stale_executions).
//
// The durable queue IS the persona_executions table: a row with status='queued'
// that the engine has admitted-but-not-yet-started must survive a process restart
// and be re-admitted (queued → running → completed), NOT silently lost. By
// contrast a row that was actively 'running' at crash is marked 'failed' with
// "App restarted while execution was running" (recover_stale_executions) — that's
// expected and is NOT what this test asserts. So we target QUEUED rows: fire more
// executions than the concurrency cap so several sit queued, then restart while
// they're queued, then assert those specific ids advanced (survived).
//
// Two-phase because the app is launched interactively by the user — a script
// self-restarting a Tauri dev process is fragile. Phase MARK snapshots the queued
// ids; the USER kills + restarts the app; Phase VERIFY checks they survived.
//
// Usage (LIVE; PERSONAS_BASE=http://127.0.0.1:17320):
//   1) node scripts/test/chaos.mjs --phase mark --team "SDLC2 — ai-bookkeeper" --count 10
//      → fires N execs, snapshots the queued ones to docs/test/runs/chaos-latest.json,
//        prints: "KILL the app now (Stop-Process), then RESTART it (tauri:dev:test on :17320)".
//   2) [user] kill + restart the app, wait for the bridge to be healthy again.
//   3) node scripts/test/chaos.mjs --phase verify
//      → reads the snapshot, asserts each snapshotted queued id is now running/completed
//        (survived) and NOT failed-with-restart-loss.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import * as bridge from './bridge.mjs';
import { argStrict as arg } from './lib/cli.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const SNAP = join('docs', 'test', 'runs', 'chaos-latest.json');

async function phaseMark() {
  const teamSel = arg('--team');
  const count = parseInt(arg('--count', '10'), 10);
  if (!teamSel) {
    console.error('usage: node scripts/test/chaos.mjs --phase mark --team <name|id> [--count 10]');
    process.exit(1);
  }
  const hc = await bridge.health();
  if (hc !== 200) {
    console.error(`bridge not healthy (${hc}) on ${bridge.BASE} — start the app + set PERSONAS_BASE. aborting.`);
    process.exit(2);
  }
  const db = openRead(MAIN_DB);
  const info = teamInfo(db, teamSel);
  db.close();
  const personaId = info.entryPersonaIds[0] || info.personaIds[0];
  const sinceIso = new Date(Date.now() - 5000).toISOString();

  // Fire more than the cap so several rows sit queued (admitted-not-started).
  const goal = JSON.stringify({ request: 'Durability probe: wait briefly then report UTC time. No file changes.', _chaos: true });
  for (let i = 0; i < count; i++) {
    bridge.invoke('execute_persona', { personaId, inputData: goal }, { timeoutMs: 6000, pollMs: 1500 }).catch(() => {});
  }
  log(`Fired ${count} executions at ${personaId}; waiting for some to QUEUE…`);

  // Poll until we see queued rows (the durable-queue substrate), then snapshot them.
  const ph = info.personaIds.map(() => '?').join(',');
  let queuedIds = [];
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const db2 = openRead(MAIN_DB);
    const rows = db2
      .prepare(`SELECT id, status FROM persona_executions WHERE persona_id IN (${ph}) AND created_at >= ?`)
      .all(...info.personaIds, sinceIso);
    db2.close();
    queuedIds = rows.filter((r) => r.status === 'queued').map((r) => r.id);
    const running = rows.filter((r) => r.status === 'running').length;
    log(`  queued=${queuedIds.length} running=${running} total=${rows.length}`);
    if (queuedIds.length >= 2) break; // enough to make the assertion meaningful
    await sleep(2000);
  }
  if (queuedIds.length === 0) {
    console.error('NO queued executions appeared — cannot test durable queue (try a higher --count, or the cap is high). aborting.');
    process.exit(3);
  }

  mkdirSync(join('docs', 'test', 'runs'), { recursive: true });
  const snap = { markedAt: nowIso(), team: info.name, personaId, sinceIso, queuedIds, personaIds: info.personaIds };
  writeFileSync(SNAP, JSON.stringify(snap, null, 2), 'utf8');
  log('—'.repeat(50));
  log(`MARKED ${queuedIds.length} queued executions: ${queuedIds.map((s) => s.slice(0, 8)).join(', ')}`);
  log(`Snapshot: ${SNAP}`);
  log('');
  log('>>> NOW: KILL the app (Stop-Process the tauri dev / personas.exe), then RESTART it');
  log('>>>      (npm run tauri:dev:test on :17320). Wait until the bridge is healthy.');
  log('>>> THEN: node scripts/test/chaos.mjs --phase verify');
}

async function phaseVerify() {
  if (!existsSync(SNAP)) {
    console.error(`no snapshot at ${SNAP} — run --phase mark first. aborting.`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  const hc = await bridge.health();
  log(`bridge health: ${hc} (expect 200 after restart)`);

  // Give the engine a moment to run requeue_persisted_executions on startup.
  log('Waiting 20s for startup requeue_persisted_executions to re-admit queued rows…');
  await sleep(20000);

  const db = openRead(MAIN_DB);
  const ph = snap.queuedIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, status, error_message FROM persona_executions WHERE id IN (${ph})`).all(...snap.queuedIds);
  db.close();

  const byId = new Map(rows.map((r) => [r.id, r]));
  const results = snap.queuedIds.map((id) => {
    const r = byId.get(id);
    const status = r?.status ?? 'MISSING';
    // Survived = the queued row was re-admitted and is now running/completed (or
    // still queued and will be picked up). LOST = failed specifically due to the
    // restart, or vanished.
    const restartLost = status === 'failed' && /restart/i.test(r?.error_message || '');
    const survived = !restartLost && status !== 'MISSING';
    return { id, status, survived, restartLost, error: r?.error_message || null };
  });
  const survivedCount = results.filter((r) => r.survived).length;
  const pass = survivedCount === snap.queuedIds.length && survivedCount > 0;

  const report = {
    kind: 'chaos-durable-queue',
    markedAt: snap.markedAt,
    verifiedAt: nowIso(),
    team: snap.team,
    queuedMarked: snap.queuedIds.length,
    survivedCount,
    pass,
    results,
  };
  const outPath = join('docs', 'test', 'runs', `chaos-report-${nowIso().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  log('—'.repeat(50));
  log(`CHAOS / DURABLE-QUEUE TEST: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  for (const r of results) log(`  ${r.id.slice(0, 8)} → ${r.status}${r.restartLost ? ' (LOST to restart ❌)' : r.survived ? ' (survived ✅)' : ''}`);
  log(`  ${survivedCount}/${snap.queuedIds.length} queued executions survived the restart`);
  log(`  report: ${outPath}`);
  process.exit(pass ? 0 : 1);
}

async function main() {
  const phase = arg('--phase');
  if (phase === 'mark') return phaseMark();
  if (phase === 'verify') return phaseVerify();
  console.error('usage: node scripts/test/chaos.mjs --phase <mark|verify> [--team <name|id>] [--count 10]');
  process.exit(1);
}

main().catch((e) => {
  console.error('chaos.mjs fatal:', e);
  process.exit(1);
});
