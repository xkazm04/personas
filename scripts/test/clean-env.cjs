// scripts/test/clean-env.cjs — reset the local env between autonomy soak runs.
//
// Pauses the 4 autonomous_* settings, backs up personas.db (VACUUM INTO, GATED —
// aborts the clear if the backup fails), clears the operational tables from the
// last run, and PRESERVES everything structural: teams, members, connections,
// event subscriptions (the handoff wiring), personas, connectors, credentials,
// dev_projects (incl. standards_config), dev_goals, team_memories (the teams'
// learned decisions), and app_settings.
//
// Aborts if any execution is running/queued. Run with the app idle.
// Usage:  node scripts/test/clean-env.cjs
// After:  re-enable the 4 autonomous_* settings (or via the bridge) to start the next run.
const D = require('better-sqlite3');
const { homedir } = require('os');
const { join } = require('path');
const fs = require('fs');

const dir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'com.personas.desktop');
const dbp = join(dir, 'personas.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const bak = join(dir, 'personas-cleanbak-' + ts + '.db');

const db = new D(dbp);
db.pragma('busy_timeout = 20000');

// 0. Safety: must be idle.
const running = db.prepare("SELECT COUNT(*) c FROM persona_executions WHERE status IN ('running','queued','pending')").get().c;
if (running > 0) { console.log('ABORT: ' + running + ' executions running/queued — not idle.'); db.close(); process.exit(1); }

// 1. Pause autonomy (settings have no cache — read directly each tick).
const PAUSE = ['autonomous_goal_advancement', 'autonomous_assignment_retry', 'autonomous_review_triage', 'autonomous_review_triage_high'];
const upd = db.prepare("UPDATE app_settings SET value='false', updated_at=? WHERE key=?");
for (const k of PAUSE) upd.run(new Date().toISOString(), k);
console.log('paused autonomy: ' + PAUSE.join(', '));

// 2. Backup (gated — abort the clear if it fails).
try {
  db.exec("VACUUM INTO '" + bak.replace(/\\/g, '/') + "'");
  console.log('backup OK -> ' + bak + ' (' + (fs.statSync(bak).size / 1048576).toFixed(1) + ' MB)');
} catch (e) {
  console.log('BACKUP FAILED — aborting clear (nothing cleared): ' + String(e.message || e).slice(0, 100));
  db.close(); process.exit(1);
}

// 3. Clear operational tables (FK off so order is safe; FTS synced by triggers + force-cleared).
const CLEAR = [
  'execution_traces', 'execution_knowledge', 'persona_execution_annotations', 'tool_execution_audit_log',
  'review_messages', 'persona_message_deliveries',
  'team_assignment_events', 'team_assignment_steps',
  'policy_events', 'audit_incidents', 'fired_alerts',
  'persona_events', 'persona_manual_reviews', 'persona_messages',
  'team_assignments', 'pipeline_runs', 'persona_executions',
];
db.pragma('foreign_keys = OFF');
const tx = db.transaction(() => {
  let n = 0;
  for (const t of CLEAR) { try { n += db.prepare('DELETE FROM ' + t).run().changes; } catch (e) { console.log('  skip ' + t + ': ' + e.message.slice(0, 40)); } }
  return n;
});
const deleted = tx();
try { db.exec("INSERT INTO executions_fts(executions_fts) VALUES('delete-all')"); } catch (e) { try { db.prepare('DELETE FROM executions_fts').run(); } catch (e2) {} }
db.pragma('foreign_keys = ON');
console.log('cleared — total rows deleted: ' + deleted);

// 4. Verify.
console.log('=== operational (must be 0) ===');
for (const t of CLEAR.concat(['executions_fts'])) { try { console.log('  ' + t + ': ' + db.prepare('SELECT COUNT(*) c FROM ' + t).get().c); } catch (e) {} }
console.log('=== preserved (intact) ===');
for (const t of ['persona_teams', 'persona_team_members', 'persona_team_connections', 'persona_event_subscriptions', 'personas', 'dev_projects', 'dev_goals', 'team_memories', 'persona_credentials', 'app_settings']) { console.log('  ' + t + ': ' + db.prepare('SELECT COUNT(*) c FROM ' + t).get().c); }
console.log('=== autonomy settings (paused = false) ===');
for (const k of PAUSE) { const r = db.prepare('SELECT value FROM app_settings WHERE key=?').get(k); console.log('  ' + k + ': ' + (r ? r.value : '?')); }
db.close();
console.log('CLEAN DONE — backup at ' + bak + '. Re-enable the 4 autonomous_* settings to start the next run.');
