#!/usr/bin/env node
// Grand Simulation switches (docs/architecture/grand-simulation.md §4 item 6, gap G7).
//
// Sets the app-level settings the simulation runs under and, per project, the autopilot
// mode and one mechanical triage rule that auto-accepts low-risk items (the first day's
// ceiling was the human accept). Idempotent: re-running restates the same values and
// creates the rule only when a rule of the same name is absent.
//
//   node scripts/e2e/sim-switches.mjs --projects bank-core,bank-edge      # apply
//   node scripts/e2e/sim-switches.mjs --projects bank-core --dry-run       # show only
//   node scripts/e2e/sim-switches.mjs --projects CandiDate --max-risk 3 --autopilot suggest
//
// Requires the app running with the test-automation server (npm run tauri:dev:test).
// The headless kp bridge (PERSONAS_HEADLESS_BRIDGE=1) is an environment variable of the
// app process, not a setting: launch the app with it set. Opus for agents is a per-charter
// modelOverride the adoption doors already write.

import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.PERSONAS_BASE ||= `http://127.0.0.1:${process.env.PERSONAS_TEST_PORT || 17320}`;
const bridge = await import('../test/bridge.mjs');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = flag('--dry-run');
const PROJECTS = (opt('--projects', '') || '').split(',').filter(Boolean);
const MAX_RISK = Number(opt('--max-risk', 3));            // strictly below
const AUTOPILOT = opt('--autopilot', 'full');             // off | measure | suggest | full
const CAP = Number(opt('--cap', 10));
const DB_PATH = process.env.PERSONAS_DB || path.join(process.env.APPDATA || os.homedir(), 'com.personas.desktop', 'personas.db');

const APP_SETTINGS = {
  autonomous_attention_loop: 'true',
  max_active_personas: String(CAP),
  max_parallel_executions: '10',
};
const RULE_NAME = `sim: accept risk below ${MAX_RISK}`;

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const projects = db.prepare('select id, name, root_path from dev_projects').all()
  .filter((p) => PROJECTS.includes(p.name) || PROJECTS.includes(p.id));
const existingRules = db.prepare('select project_id, name, enabled from dev_triage_rules').all();
db.close();
if (PROJECTS.length && projects.length !== PROJECTS.length) {
  const found = new Set(projects.map((p) => p.name));
  console.error('unknown project(s): ' + PROJECTS.filter((n) => !found.has(n)).join(', '));
  process.exit(1);
}

console.log('app settings:', APP_SETTINGS);
for (const p of projects) console.log(`project ${p.name} (${p.id.slice(0, 8)}): autopilot ${AUTOPILOT}; rule "${RULE_NAME}"${existingRules.some((r) => r.project_id === p.id && r.name === RULE_NAME) ? ' (exists)' : ''}`);
if (DRY) { console.log('(dry run)'); process.exit(0); }

await bridge.health();
for (const [key, value] of Object.entries(APP_SETTINGS)) {
  await bridge.invoke('set_app_setting', { key, value });
  console.log(`set ${key}=${value}`);
}
for (const p of projects) {
  await bridge.invoke('set_app_setting', { key: `autopilot_mode:${p.id}`, value: AUTOPILOT });
  console.log(`set autopilot_mode:${p.id.slice(0, 8)}=${AUTOPILOT}`);
  if (!existingRules.some((r) => r.project_id === p.id && r.name === RULE_NAME)) {
    // conditions: ALL must match; numeric fields default to 0 when null, so a risk of null
    // would pass "lt" — require risk >= 1 too so unrated items are never auto-accepted.
    const conditions = JSON.stringify([
      { field: 'risk', op: 'gte', value: 1 },
      { field: 'risk', op: 'lt', value: MAX_RISK },
    ]);
    await bridge.invoke('dev_tools_create_triage_rule', { projectId: p.id, name: RULE_NAME, conditions, action: 'accept' });
    console.log(`created rule "${RULE_NAME}" on ${p.name}`);
  }
}
console.log('done');
