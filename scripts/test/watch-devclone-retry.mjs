// Watch the Medical Bill Dev Clone retry: exit when it reaches a terminal state
// or a PR-created event appears. Read-only.
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const DB = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'com.personas.desktop', 'personas.db');
const TID = 'ee73dd94-4267-4735-9f5d-87c04e385aea';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new Database(DB, { readonly: true, fileMustExist: true });
const pids = db.prepare('SELECT persona_id FROM persona_team_members WHERE team_id=?').all(TID).map((m) => m.persona_id);
const dc = db.prepare("SELECT m.persona_id FROM persona_team_members m WHERE m.team_id=? AND json_extract(m.config,'$.preset_role')='engineer'").get(TID).persona_id;
db.close();

const start = Date.now();
const HARD = 24 * 60 * 1000;
while (true) {
  const d = new Database(DB, { readonly: true, fileMustExist: true });
  const last = d.prepare("SELECT status, created_at FROM persona_executions WHERE persona_id=? AND created_at > '2026-06-01T14:00' ORDER BY created_at DESC LIMIT 1").get(dc);
  const pr = d.prepare("SELECT COUNT(*) n FROM persona_events WHERE event_type='dev-clone.pr.created' AND created_at > '2026-06-01T14:00'").get().n;
  const impl = d.prepare("SELECT COUNT(*) n FROM persona_events WHERE event_type='implementation.completed' AND created_at > '2026-06-01T14:00'").get().n;
  d.close();
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] DevClone=${last ? last.status : 'none'} pr.created=${pr} impl.completed=${impl}`);
  if (pr > 0) { console.log('RESULT: PR CREATED — Dev Clone opened a PR on the retry'); break; }
  if (last && (last.status === 'completed' || last.status === 'failed')) {
    console.log(`RESULT: Dev Clone retry ${last.status} (pr.created=${pr}, impl.completed=${impl})`); break;
  }
  if (Date.now() - start >= HARD) { console.log('RESULT: TIMEOUT watching retry'); break; }
  await sleep(30000);
}
