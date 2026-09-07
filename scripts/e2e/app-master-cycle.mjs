#!/usr/bin/env node
// App Master e2e cycle driver (docs/architecture/app-master-e2e.md, D7).
//
// One cycle = adopt (idempotent) the App Master for each target project over the
// loopback dev-tools bridge, switch the living-agent attention loop on, enable the
// personas, observe the attention ledger / executions / episodes / target-repo
// branches for a window, and write an evidence report the improvement pass reads.
//
// Requires the app RUNNING with the test-automation server (`npm run tauri:dev:test`)
// because the settings + enable commands go through `window.__TEST__.invokeCommand`;
// adoption itself needs only the dev-tools bridge (token from ~/.personas/local-http.json).
//
//   node scripts/e2e/app-master-cycle.mjs                # adopt + enable + observe 12 min + report
//   node scripts/e2e/app-master-cycle.mjs --adopt-only
//   node scripts/e2e/app-master-cycle.mjs --observe 30   # minutes
//   node scripts/e2e/app-master-cycle.mjs --report-only  # evidence for the current state
//   node scripts/e2e/app-master-cycle.mjs --disable      # switch the three personas off
//
// Env: PERSONAS_BASE (test bridge, default http://127.0.0.1:17320), PERSONAS_DB (override
// the live db path), APP_MASTER_PROJECTS (comma-separated root paths).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

process.env.PERSONAS_BASE ||= 'http://127.0.0.1:17320';
const bridge = await import('../test/bridge.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const OBSERVE_MIN = Number(opt('--observe', 12));
const TARGETS = (process.env.APP_MASTER_PROJECTS ||
  'C:\\Users\\kazda\\kiro\\kp,C:\\Users\\kazda\\kiro\\ascent,C:\\Users\\kazda\\kiro\\personas-web').split(',');

// The six responsibilities and their operator priorities (1 = highest; absent = the
// persona decides). Mixed on purpose so the decision lane exercises both rules.
const RECIPES = [
  { slug: 'project-kpi-stewardship', priority: 1 },
  { slug: 'accepted-idea-delivery', priority: 2 },
  { slug: 'codebase-security-scan', priority: 3 },
  { slug: 'codebase-static-analysis-sweep', priority: 3 },
  { slug: 'codebase-architecture-review', priority: 4 },
  { slug: 'technical-decision-capture' },
];

const DB_PATH = process.env.PERSONAS_DB ||
  path.join(process.env.APPDATA || '', 'com.personas.desktop', 'personas.db');

function handshake() {
  const p = path.join(os.homedir(), '.personas', 'local-http.json');
  const h = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { base: `http://127.0.0.1:${h.port}/dev-tools`, token: h.token, pid: h.pid };
}

async function bridgeFetch(h, route, body) {
  const res = await fetch(h.base + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Personas-Local-Token': h.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${route} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

function openDb() {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function q(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch (e) { return [{ error: String(e.message || e) }]; }
}

function gitBranches(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'for-each-ref', '--sort=-committerdate',
      '--format=%(refname:short)|%(committerdate:iso8601)', 'refs/heads/autopilot/', 'refs/heads/app-master/'],
      { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).map((l) => { const [b, d] = l.split('|'); return { branch: b, at: d }; });
  } catch (e) { return [{ error: String(e.message || e).split('\n')[0] }]; }
}

function gitWorktrees(root) {
  try {
    return execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
      .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
  } catch { return []; }
}

async function resolveProjects(h) {
  const list = await bridgeFetch(h, '/projects');
  const rows = Array.isArray(list) ? list : (list.projects ?? []);
  return TARGETS.map((t) => {
    const hit = rows.find((r) => norm(r.root_path ?? r.rootPath) === norm(t));
    if (!hit) throw new Error(`project not registered for root ${t}; register it first (POST /dev-tools/projects)`);
    return { id: hit.id, name: hit.name, root: hit.root_path ?? hit.rootPath };
  });
}

async function adopt(h, projects) {
  const out = [];
  for (const p of projects) {
    const r = await bridgeFetch(h, '/app-master/adopt', {
      project: p.id, recipes: RECIPES, model: 'opus', maxConcurrent: 2, scopeRung: 2, enabled: false,
    });
    out.push({ project: p.name, ...r });
    console.log(`adopted ${p.name}: persona ${r.personaId} (${r.created ? 'created' : 'updated'}), charters ${r.charters?.length}, suspended ${r.suspended?.length ?? 0}${r.notes?.length ? ' notes: ' + r.notes.join(' | ') : ''}`);
  }
  return out;
}

async function setEnabled(personaIds, enabled) {
  await bridge.health();
  for (const id of personaIds) {
    const r = await bridge.invoke('set_persona_enabled', { personaId: id, enabled });
    console.log(`set_persona_enabled ${id} -> ${enabled}: ${String(JSON.stringify(r) ?? r).slice(0, 120)}`);
  }
}

async function setAttentionLoop(on) {
  await bridge.health();
  const r = await bridge.invoke('set_app_setting', { key: 'autonomous_attention_loop', value: on ? 'true' : 'false' });
  console.log(`autonomous_attention_loop=${on}: ${String(JSON.stringify(r) ?? r).slice(0, 120)}`);
}

function snapshot(projects, personaIds) {
  const db = openDb();
  const ids = personaIds.length ? personaIds : q(db, `select id from personas where name like 'App Master%'`).map((r) => r.id);
  const inList = ids.map(() => '?').join(',') || "''";
  const snap = {
    at: new Date().toISOString(),
    personas: q(db, `select id,name,enabled,max_concurrent,model_profile,setup_status from personas where id in (${inList})`, ids),
    charters: q(db, `select id,persona_id,title,status,scope_rung,project_id,cadence,json_extract(spec,'$.priority') as priority,json_extract(spec,'$.recipeRef.slug') as slug,json_extract(spec,'$.pacing') as pacing from persona_responsibilities where persona_id in (${inList}) order by persona_id, priority`, ids),
    ledger: q(db, `select id,persona_id,responsibility_id,lane,verdict,started_at,completed_at,substr(stats_json,1,600) as stats,substr(reason,1,200) as reason from persona_attention_ledger where persona_id in (${inList}) order by started_at desc limit 60`, ids),
    executions: q(db, `select id,persona_id,status,started_at,completed_at,model_used,cost_usd,substr(error_message,1,200) as error from persona_executions where persona_id in (${inList}) order by started_at desc limit 40`, ids),
    fleet: q(db, `select id,project_label,title,state,state_reason,run_label,created_at_ms,last_activity_ms from fleet_sessions where run_label like 'app-master:%' order by created_at_ms desc limit 40`),
    episodes: q(db, `select id,persona_id,responsibility_id,role,source,chars,created_at from persona_episodes where persona_id in (${inList}) order by created_at desc limit 40`, ids),
    ideas: projects.map((p) => ({ project: p.name, ...Object.fromEntries(q(db, `select status, count(*) n from dev_ideas where project_id=? group by status`, [p.id]).map((r) => [r.status, r.n])) })),
    kpiMeasurements: q(db, `select k.project_id, count(m.id) n, max(m.measured_at) newest from dev_kpi_measurements m join dev_kpis k on k.id=m.kpi_id group by k.project_id`),
    repos: projects.map((p) => ({ project: p.name, branches: gitBranches(p.root), worktrees: gitWorktrees(p.root).length })),
    settings: q(db, `select key,value from app_settings where key in ('autonomous_attention_loop','max_parallel_executions')`),
  };
  db.close();
  return snap;
}

function writeReport(dir, before, after, adoption) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify({ adoption, before, after }, null, 2));
  const newLedger = after.ledger.filter((r) => !before.ledger.some((b) => b.id === r.id));
  const newExec = after.executions.filter((r) => !before.executions.some((b) => b.id === r.id));
  const newEpisodes = after.episodes.filter((r) => !before.episodes.some((b) => b.id === r.id));
  const lines = [
    `# App Master cycle ${path.basename(dir)}`, '',
    `Window: ${before.at} -> ${after.at}`, '',
    `## Ledger rows in window: ${newLedger.length}`,
    ...newLedger.map((r) => `- ${r.started_at} ${r.lane ?? '-'} ${r.verdict ?? '(open)'} persona ${r.persona_id.slice(0, 8)} charter ${r.responsibility_id ?? '-'}${r.stats ? ' ' + r.stats : ''}${r.reason ? ' reason=' + r.reason : ''}`),
    '', `## Executions in window: ${newExec.length}`,
    ...newExec.map((r) => `- ${r.started_at} ${r.status} ${r.id.slice(0, 8)} ${r.model_used ?? ''} $${r.cost_usd ?? '?'}${r.error ? ' error: ' + r.error : ''}`),
    '', `## Fleet sessions (app-master runs): ${after.fleet.length}`,
    ...after.fleet.map((s) => `- ${new Date(Number(s.created_at_ms)).toISOString()} ${s.state} ${s.project_label} "${s.title ?? ''}" ${s.state_reason ?? ''} (${s.run_label})`),
    '', `## Episodes in window: ${newEpisodes.length}`,
    '', '## Charters (after)',
    ...after.charters.map((c) => `- ${c.persona_id.slice(0, 8)} ${c.slug ?? c.title} p=${c.priority ?? '-'} ${c.status} rung ${c.scope_rung} pacing=${c.pacing ?? '-'}`),
    '', '## Repos', ...after.repos.map((r) => `- ${r.project}: ${r.branches.length} autopilot branches, ${r.worktrees} worktrees`),
    '', '## Ideas', ...after.ideas.map((i) => `- ${JSON.stringify(i)}`),
    '', '## Settings', ...after.settings.map((s) => `- ${s.key}=${s.value}`),
  ];
  fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n');
  console.log(`\nreport: ${path.join(dir, 'report.md')}`);
  console.log(lines.slice(4).join('\n'));
}

async function main() {
  const h = handshake();
  console.log(`bridge ${h.base} (pid ${h.pid}); db ${DB_PATH}`);
  const projects = await resolveProjects(h);
  console.log('projects: ' + projects.map((p) => `${p.name}=${p.id.slice(0, 8)}`).join(', '));

  let adoption = null;
  let personaIds = [];
  if (!flag('--report-only') && !flag('--disable') && !flag('--no-adopt')) {
    adoption = await adopt(h, projects);
    personaIds = adoption.map((a) => a.personaId);
  } else {
    const db = openDb();
    personaIds = q(db, `select id from personas where name like 'App Master%'`).map((r) => r.id);
    db.close();
  }
  if (flag('--disable')) { await setEnabled(personaIds, false); return; }
  if (flag('--adopt-only')) return;

  const before = snapshot(projects, personaIds);
  if (!flag('--report-only')) {
    await setAttentionLoop(true);
    await setEnabled(personaIds, true);
    console.log(`observing for ${OBSERVE_MIN} min (attention loop: 120 s initial delay, 300 s tick)...`);
    const end = Date.now() + OBSERVE_MIN * 60_000;
    let lastCount = -1;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 60_000));
      const s = snapshot(projects, personaIds);
      const n = s.ledger.length + s.executions.length;
      if (n !== lastCount) { console.log(`${s.at} ledger ${s.ledger.length} executions ${s.executions.length} episodes ${s.episodes.length}`); lastCount = n; }
    }
  }
  const after = snapshot(projects, personaIds);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  writeReport(path.join(ROOT, 'docs', 'architecture', 'app-master-e2e', 'cycles', stamp), before, after, adoption);
}

main().catch((e) => { console.error('cycle failed:', e.message || e); process.exit(1); });
