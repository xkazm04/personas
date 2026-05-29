// Read-only SQLite access for the Team Autonomy Evaluation Framework.
// See docs/tests/autonomy-eval/run-protocol.md §1, §4. We NEVER open these DBs writable —
// the live app owns them; we are an observer that reads truth.
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APPDATA = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
const APP_DIR = join(APPDATA, 'com.personas.desktop');

/** Main app DB: personas, executions, reviews, memories, teams, events, pipeline_runs. */
export const MAIN_DB = process.env.PERSONAS_DB || join(APP_DIR, 'personas.db');
/** User DB: companion brain (goals, approvals, episodic/semantic memory). */
export const USER_DB = process.env.PERSONAS_USER_DB || join(APP_DIR, 'personas_data.db');

/**
 * Open a DB read-only. WAL mode lets us read concurrently while the app holds
 * the write lock; busy_timeout covers the rare checkpoint contention.
 */
export function openRead(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Parse a JSON column with a three-state result:
 *   null      → column was NULL/empty (absent)
 *   undefined → column had text but failed to parse (CORRUPT — a real finding)
 *   value     → parsed ok
 * The distinction matters: a corrupt structured_prompt silently falls back to
 * system_prompt at runtime, so "corrupt" is a blocker while "absent" is its own case.
 */
export function tryJson(s) {
  if (s == null || s === '') return null;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
