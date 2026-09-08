#!/usr/bin/env node
// Act 0 dry run for the Grand Simulation (docs/architecture/grand-simulation.md §2, Act 0 exit
// criterion: "the headless services exist and are proven by a dry run on a throwaway workspace").
//
// Creates a throwaway workspace, one project with a real repository under a throwaway root,
// protects the workspace, adopts an Architect on it (when the door exists) and an App Master on
// the project, applies the simulation switches, enables both within the cap, and reports what
// the doors returned. Nothing here touches an existing workspace or project.
//
//   node scripts/e2e/sim-act0-dryrun.mjs                        # full dry run
//   node scripts/e2e/sim-act0-dryrun.mjs --root C:\Users\kazda\kiro\sim-dryrun --keep
//
// Requires the app running with the test-automation server (npm run tauri:dev:test) and the
// dev-tools bridge handshake at ~/.personas/local-http.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PERSONAS_BASE ||= `http://127.0.0.1:${process.env.PERSONAS_TEST_PORT || 17320}`;
const bridge = await import('../test/bridge.mjs');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const WORKSPACE = opt('--workspace', `sim-dryrun-${STAMP}`);
const ROOT = opt('--root', path.join(os.tmpdir(), 'personas-sim-dryrun'));
const PROJECT = opt('--project', 'dryrun-core');

function handshake() {
  const h = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.personas', 'local-http.json'), 'utf8'));
  return { base: `http://127.0.0.1:${h.port}/dev-tools`, token: h.token };
}
async function call(h, method, route, body) {
  const res = await fetch(h.base + route, {
    method, headers: { 'X-Personas-Local-Token': h.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}
const step = (name, r) => { console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${name} -> ${r.status} ${JSON.stringify(r.json).slice(0, 220)}`); return r; };

const h = handshake();
console.log(`bridge ${h.base}; workspace ${WORKSPACE}; root ${ROOT}`);
fs.mkdirSync(ROOT, { recursive: true });

// 1. workspace + project + repository in one step (G6)
const created = step('projects/create', await call(h, 'POST', '/projects/create', {
  workspace: WORKSPACE, name: PROJECT, description: 'Act 0 dry run', techStack: 'rust', template: 'rust-service', root: ROOT,
}));
if (!created.ok) process.exit(1);
const projectId = created.json.project?.id;
const workspaceId = created.json.workspaceId;
const repoPath = created.json.repositoryPath;
console.log(`   project ${projectId} at ${repoPath}; git: ${fs.existsSync(path.join(repoPath, '.git')) ? 'initialised' : 'MISSING'}`);

// 2. protect the workspace (never-delete tag), list it
step('workspaces/protect', await call(h, 'POST', `/workspaces/${workspaceId}/protect`, { lastWorkingVersion: true }));
const ws = step('workspaces', await call(h, 'GET', '/workspaces'));
const mine = (Array.isArray(ws.json) ? ws.json : []).find((w) => w.id === workspaceId);
console.log(`   listed: ${mine ? `protected=${mine.protected} projects=${mine.projectCount}` : 'NOT LISTED'}`);

// 3. App Master on the project (existing door), disabled
const am = step('app-master/adopt', await call(h, 'POST', '/app-master/adopt', {
  project: projectId, recipes: [{ slug: 'project-kpi-stewardship', priority: 1 }, { slug: 'accepted-idea-delivery', priority: 2 }], model: 'opus', maxConcurrent: 2, enabled: false,
}));

// 4. Architect on the workspace (door built by G1; tolerated absent)
const arch = step('architect/adopt', await call(h, 'POST', '/architect/adopt', {
  workspace: workspaceId, recipes: [{ slug: 'enterprise-solution-design', priority: 1 }, { slug: 'project-portfolio-composition', priority: 2 }, { slug: 'goal-direction-and-authority', priority: 3 }], model: 'opus', enabled: false,
}));
if (arch.status === 404) console.log('   (architect door not present yet: G1 pending)');

// 5. switches, then enable within the cap
await bridge.health();
for (const [key, value] of Object.entries({ autonomous_attention_loop: 'true', max_active_personas: '10' })) {
  await bridge.invoke('set_app_setting', { key, value }); console.log(`ok   setting ${key}=${value}`);
}
for (const [label, id] of [['app master', am.json.personaId], ['architect', arch.json?.personaId]]) {
  if (!id) continue;
  try { await bridge.invoke('set_persona_enabled', { personaId: id, enabled: true }); console.log(`ok   enabled ${label} ${id.slice(0, 8)}`); }
  catch (e) { console.log(`FAIL enable ${label}: ${String(e.message || e).slice(0, 160)}`); }
}
const state = step('app-master state', await call(h, 'GET', `/app-master/${projectId}`));
console.log(`   active personas: ${JSON.stringify(state.json.activePersonas ?? 'n/a')}`);

console.log(`\nDry run done. Workspace ${WORKSPACE} is protected; delete paths must refuse it.${flag('--keep') ? '' : ' Disable the two personas by hand when finished (the workspace stays, by design).'}`);
