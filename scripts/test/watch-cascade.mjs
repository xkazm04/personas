// Lightweight cascade watcher — polls persona_executions for the f8a981a8
// re-validation cascade until 8/8 members have run and nothing is running,
// or it goes quiet, or a hard timeout. Read-only; no app interaction.
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const SINCE = process.argv[2] || '2026-06-01T11:44';
const TID = 'f8a981a8-79aa-46ee-bc19-b68c087dc96d';
const db = new Database(
  join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'com.personas.desktop', 'personas.db'),
  { readonly: true, fileMustExist: true },
);
const name = (id) => { const p = db.prepare('SELECT name FROM personas WHERE id=?').get(id); return p ? p.name : '?'; };
const members = db.prepare('SELECT persona_id FROM persona_team_members WHERE team_id=?').all(TID).map((m) => m.persona_id);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = Date.now();
const HARD_MS = 42 * 60 * 1000;
const QUIET_MS = 4 * 60 * 1000;
let lastSig = '';
let lastChange = Date.now();

function snapshot() {
  const rows = db.prepare(
    "SELECT persona_id, status FROM persona_executions WHERE created_at > ? ORDER BY created_at",
  ).all(SINCE);
  const byP = new Map();
  let running = 0;
  for (const r of rows) {
    byP.set(r.persona_id, r.status);
    if (r.status === 'running' || r.status === 'queued') running += 1;
  }
  const distinct = [...byP.keys()].filter((p) => members.includes(p)).length;
  return { rows: rows.length, distinct, running, byP };
}

while (true) {
  const s = snapshot();
  const sig = `${s.rows}|${s.distinct}|${s.running}`;
  if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
  const ran = members.filter((p) => s.byP.has(p)).map((p) => name(p).replace('T: ', '').slice(0, 10));
  const missing = members.filter((p) => !s.byP.has(p)).map((p) => name(p).replace('T: ', '').slice(0, 10));
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] execs=${s.rows} personas=${s.distinct}/8 running=${s.running} | ran=[${ran.join(',')}] missing=[${missing.join(',')}]`);

  if (s.distinct >= 8 && s.running === 0) { console.log('RESULT: COMPLETE 8/8'); break; }
  if (s.running === 0 && Date.now() - lastChange >= QUIET_MS) { console.log(`RESULT: QUIESCED at ${s.distinct}/8 (no change ${Math.round((Date.now() - lastChange) / 1000)}s)`); break; }
  if (Date.now() - start >= HARD_MS) { console.log(`RESULT: TIMEOUT at ${s.distinct}/8`); break; }
  await sleep(25000);
}
db.close();
