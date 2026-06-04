// One-off: re-compose the canonical SDLC teams to the full 8-member roster.
// For each team: retry_team_preset_members (adds missing members, enabled +
// wired), pin new code-track members to the repo (devProjectId), and enable
// any pre-existing disabled members. Artist is non-code-track → no pin needed.
// Run with PERSONAS_BASE=http://127.0.0.1:17320.
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import * as b from './bridge.mjs';

const DB_PATH = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'com.personas.desktop', 'personas.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const role = (m) => { try { return JSON.parse(m.config || '{}').preset_role; } catch { return '?'; } };

const TEAMS = [
  { name: 'Apprenticeship', teamId: '865cf3f6-fc2e-4388-a16e-625c9a720e4d', proj: '0d66648d-4e25-485a-96bc-bb4f32cf96af', roles: ['qa', 'artist'] },
  { name: 'Grant Writing', teamId: '048e57fb-636c-405a-b109-11d3fea18160', proj: '7a26ad2e-5866-405f-abdb-48af86ad8a0e', roles: ['qa', 'artist'] },
  { name: 'Immigration', teamId: '27328eda-3e88-4fed-b612-f5985ea63f4f', proj: 'c337dab9-696e-4789-8e91-56fb40c2cad9', roles: ['qa', 'artist'] },
  { name: 'Local SEO', teamId: 'f1a5be07-9e53-4d61-82a6-9437a86798e9', proj: 'dbaa0abb-9950-4dc9-a6fc-4aba22f62352', roles: ['engineer', 'qa', 'artist'] },
  { name: 'Medical Bill', teamId: 'ee73dd94-4267-4735-9f5d-87c04e385aea', proj: '3e1f8d3e-fcc5-465c-ae0e-c003b6faacfc', roles: ['engineer', 'qa', 'artist'] },
];

const members = (db, teamId) =>
  db.prepare('SELECT m.persona_id, m.config FROM persona_team_members m WHERE m.team_id=?').all(teamId);

for (const t of TEAMS) {
  console.log(`\n=== ${t.name} (${t.teamId.slice(0, 8)}) — add [${t.roles.join(',')}] ===`);
  // 1. retry (adds missing members)
  try {
    await b.invoke('retry_team_preset_members',
      { presetId: 'sdlc-lifecycle', teamId: t.teamId, homeTeamId: t.teamId, roles: t.roles, language: 'en', parameterOverrides: null },
      { timeoutMs: 120000 });
    console.log('  retry: ok');
  } catch (e) {
    console.log('  retry:', String(e.message).slice(0, 60), '(verifying via DB)');
  }
  await sleep(1500);

  // 2. inspect + pin new code-track members + enable disabled
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const mem = members(db, t.teamId);
  console.log(`  members now: ${mem.length}`);
  const toPin = [];
  const toEnable = [];
  for (const m of mem) {
    const r = role(m);
    const p = db.prepare('SELECT name, enabled, design_context FROM personas WHERE id=?').get(m.persona_id);
    let dc = {}; try { dc = JSON.parse(p.design_context || '{}'); } catch { /* keep {} */ }
    if (r !== 'artist' && dc.devProjectId !== t.proj) toPin.push({ id: m.persona_id, role: r, dc });
    if (!p.enabled) toEnable.push({ id: m.persona_id, role: r });
  }
  db.close();

  for (const x of toPin) {
    x.dc.devProjectId = t.proj;
    try { await b.invoke('update_persona', { id: x.id, input: { design_context: JSON.stringify(x.dc) } }, { timeoutMs: 30000 }); console.log(`  pinned ${x.role}`); }
    catch (e) { console.log(`  pin ${x.role}:`, String(e.message).slice(0, 50)); }
  }
  for (const x of toEnable) {
    try { await b.invoke('update_persona', { id: x.id, input: { enabled: true } }, { timeoutMs: 30000 }); console.log(`  enabled ${x.role}`); }
    catch (e) { console.log(`  enable ${x.role}:`, String(e.message).slice(0, 50)); }
  }
  if (!toPin.length && !toEnable.length) console.log('  (nothing to pin/enable)');
}
console.log('\nDONE — run health-lint to verify all 7.');
