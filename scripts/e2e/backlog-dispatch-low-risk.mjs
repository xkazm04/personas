#!/usr/bin/env node
// Approve and dispatch every PENDING backlog idea whose risk is below a threshold,
// grouped by project, through the app's own dispatch door (which accepts the idea
// server-side and mints the task: "dispatching IS the decision").
//
// Operator directive 2026-09-07: "approve programmatically all items with Risk less
// than 3, group and dispatch subagents to resolve". Risk is the 1..10 score the idea
// protocol validates; an idea with NO risk is not below the threshold and is listed,
// not dispatched (a missing score is not a low score).
//
//   node scripts/e2e/backlog-dispatch-low-risk.mjs               # dry run: what would go
//   node scripts/e2e/backlog-dispatch-low-risk.mjs --apply       # dispatch, 2 workers per project
//   node scripts/e2e/backlog-dispatch-low-risk.mjs --apply --max-risk 3 --per-project 2 --projects CandiDate,ascent
//
// Requires the app running with the test-automation server (npm run tauri:dev:test);
// PERSONAS_TEST_PORT selects the harness port (default 17320).

import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.PERSONAS_BASE ||= `http://127.0.0.1:${process.env.PERSONAS_TEST_PORT || 17320}`;
const bridge = await import('../test/bridge.mjs');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const APPLY = flag('--apply');
const MAX_RISK = Number(opt('--max-risk', 3));          // strictly below
const PER_PROJECT = Number(opt('--per-project', 2));
const ONLY = (opt('--projects', '') || '').split(',').filter(Boolean);
const DB_PATH = process.env.PERSONAS_DB || path.join(process.env.APPDATA || os.homedir(), 'com.personas.desktop', 'personas.db');

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const rows = db.prepare(`
  select i.id, i.title, i.risk, i.effort, i.impact, i.category, p.name as project
    from dev_ideas i join dev_projects p on p.id = i.project_id
   where i.status = 'pending'
   order by p.name, i.risk, i.created_at`).all();
db.close();

const unrated = rows.filter((r) => r.risk === null || r.risk === undefined);
const eligible = rows.filter((r) => r.risk !== null && r.risk !== undefined && r.risk < MAX_RISK && (!ONLY.length || ONLY.includes(r.project)));
const groups = new Map();
for (const r of eligible) { if (!groups.has(r.project)) groups.set(r.project, []); groups.get(r.project).push(r); }

console.log(`pending: ${rows.length} · unrated (no risk, NOT dispatched): ${unrated.length} · eligible (risk < ${MAX_RISK}): ${eligible.length}`);
for (const [project, items] of groups) {
  console.log(`\n== ${project}: ${items.length} item(s)`);
  for (const r of items) console.log(`   r${r.risk} e${r.effort ?? '-'} i${r.impact ?? '-'} ${r.id.slice(0, 8)} ${r.title.slice(0, 90)}`);
}
if (!APPLY) { console.log('\n(dry run; pass --apply to dispatch)'); process.exit(0); }

await bridge.health();
const summary = [];
for (const [project, items] of groups) {
  const ideaIds = items.map((r) => r.id);
  const res = await bridge.invoke('dev_tools_dispatch_ideas', { ideaIds, target: 'fleet', depth: null, maxParallel: PER_PROJECT }, { timeoutMs: 300000 });
  const line = `${project}: dispatched ${ideaIds.length} -> ${JSON.stringify(res ?? {}).slice(0, 200)}`;
  console.log(line); summary.push(line);
}
console.log('\ndone: ' + summary.length + ' project group(s)');
