// C2 LOAD driver — proves the load-management / concurrency cap (P0 + engine/queue.rs
// ConcurrencyTracker, GLOBAL_MAX_CONCURRENT default 4). Fires N>cap executions at one
// persona concurrently, then samples persona_executions from SQLite to assert that at
// no instant did more than the cap run simultaneously AND that none were dropped (every
// fired execution reaches a terminal state). This is a LIVE driver — needs the app on
// PERSONAS_BASE (set it to :17320). Not golden-diffable.
//
// Usage:
//   PERSONAS_BASE=http://127.0.0.1:17320 node scripts/test/load.mjs --team "SDLC2 — ai-bookkeeper" --count 8 [--cap 4] [--minutes 15]
//
// The assertion is intentionally conservative: the GLOBAL cap bounds concurrency across
// ALL personas, so observing <= cap concurrent for one persona is necessary-not-sufficient;
// we ALSO report the global concurrent-running high-water mark across the team.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import * as bridge from './bridge.mjs';
import { argStrict as arg } from './lib/cli.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

async function main() {
  const teamSel = arg('--team');
  const count = parseInt(arg('--count', '8'), 10);
  const cap = parseInt(arg('--cap', '4'), 10); // engine GLOBAL_MAX_CONCURRENT default
  const windowMin = parseInt(arg('--minutes', '15'), 10);
  if (!teamSel) {
    console.error('usage: node scripts/test/load.mjs --team <name|id> --count N [--cap 4] [--minutes 15]');
    process.exit(1);
  }

  const hc = await bridge.health();
  if (hc !== 200) {
    console.error(`bridge not healthy (${hc}) on ${bridge.BASE} — start the app (tauri:dev:test on :17320) and set PERSONAS_BASE. aborting.`);
    process.exit(2);
  }

  const db = openRead(MAIN_DB);
  const info = teamInfo(db, teamSel);
  db.close();
  const personaId = info.entryPersonaIds[0] || info.personaIds[0];
  const personaName = info.members.find((m) => m.id === personaId)?.name || personaId;
  log(`Team ${info.name}: firing ${count} concurrent executions at "${personaName}" (cap=${cap})`);

  const sinceIso = new Date(Date.now() - 5000).toISOString();
  const startedAt = nowIso();

  // FIRE: launch N executions concurrently. We do NOT await completion — fire-and-forget
  // so the engine's admit() must queue everything beyond the cap. A trivial goal keeps cost low.
  const goal = JSON.stringify({ request: 'Concurrency probe: report the current UTC time and exit. No file changes.', _load: true });
  const fired = [];
  for (let i = 0; i < count; i++) {
    fired.push(
      bridge
        .invoke('execute_persona', { personaId, inputData: goal }, { timeoutMs: 8000, pollMs: 1500 })
        .catch((e) => ({ _fireErr: e.message })),
    );
  }
  // Don't block on the fires returning (execute_persona may block until completion); start sampling immediately.
  log(`Fired ${count} executions; sampling concurrency from SQLite…`);

  // SAMPLE: poll persona_executions, tracking the high-water mark of concurrent running.
  const ph = info.personaIds.map(() => '?').join(',');
  const deadline = Date.now() + windowMin * 60 * 1000;
  let personaHWM = 0; // max simultaneous running for the target persona
  let globalHWM = 0; // max simultaneous running across the whole team
  const samples = [];
  let lastChange = Date.now();
  let lastTerminal = -1;
  while (Date.now() < deadline) {
    const db2 = openRead(MAIN_DB);
    const rows = db2
      .prepare(`SELECT id, persona_id, status FROM persona_executions WHERE persona_id IN (${ph}) AND created_at >= ?`)
      .all(...info.personaIds, sinceIso);
    db2.close();
    const personaRunning = rows.filter((r) => r.persona_id === personaId && r.status === 'running').length;
    const globalRunning = rows.filter((r) => r.status === 'running').length;
    const queued = rows.filter((r) => r.status === 'queued').length;
    const terminal = rows.filter((r) => r.status === 'completed' || r.status === 'failed').length;
    personaHWM = Math.max(personaHWM, personaRunning);
    globalHWM = Math.max(globalHWM, globalRunning);
    samples.push({ t: nowIso(), personaRunning, globalRunning, queued, terminal, total: rows.length });
    if (terminal !== lastTerminal) {
      lastTerminal = terminal;
      lastChange = Date.now();
      log(`  running(persona=${personaRunning},global=${globalRunning}) queued=${queued} terminal=${terminal}/${rows.length}`);
    }
    // Done when at least `count` of OUR fired execs are terminal and nothing is running/queued.
    if (terminal >= count && personaRunning === 0 && globalRunning === 0 && queued === 0) break;
    // Safety quiescence: nothing changed for 90s and nothing running → stop.
    if (personaRunning === 0 && globalRunning === 0 && queued === 0 && Date.now() - lastChange > 90000) break;
    await sleep(2000);
  }

  // ASSERT.
  const db3 = openRead(MAIN_DB);
  const finalRows = db3
    .prepare(`SELECT id, persona_id, status FROM persona_executions WHERE persona_id IN (${ph}) AND created_at >= ?`)
    .all(...info.personaIds, sinceIso);
  db3.close();
  const terminalCount = finalRows.filter((r) => r.status === 'completed' || r.status === 'failed').length;
  const stillOpen = finalRows.filter((r) => r.status === 'running' || r.status === 'queued').length;

  const capRespected = personaHWM <= cap && globalHWM <= cap;
  const noneDropped = terminalCount >= count && stillOpen === 0;
  const pass = capRespected && noneDropped;

  const outDir = join('docs', 'test', 'runs', `load-${startedAt.replace(/[:.]/g, '-').slice(0, 19)}`);
  mkdirSync(outDir, { recursive: true });
  const report = {
    kind: 'load',
    team: info.name,
    personaId,
    personaName,
    requested: count,
    cap,
    personaConcurrentHWM: personaHWM,
    globalConcurrentHWM: globalHWM,
    observedExecutions: finalRows.length,
    terminalCount,
    stillOpen,
    capRespected,
    noneDropped,
    pass,
    samples,
  };
  writeFileSync(join(outDir, 'load-report.json'), JSON.stringify(report, null, 2), 'utf8');

  log('—'.repeat(50));
  log(`LOAD TEST: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  log(`  cap respected: ${capRespected} (persona HWM ${personaHWM}, global HWM ${globalHWM}, cap ${cap})`);
  log(`  none dropped: ${noneDropped} (${terminalCount} terminal of ${count} requested; ${stillOpen} still open)`);
  log(`  report: ${join(outDir, 'load-report.json')}`);
  // settle outstanding fire promises so node can exit cleanly
  await Promise.allSettled(fired);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('load.mjs fatal:', e);
  process.exit(1);
});
