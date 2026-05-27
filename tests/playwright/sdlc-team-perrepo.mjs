/** Phase 4: adopt the sdlc-lifecycle preset once per repo, each team pinned to
 * its own dev_project (codebase). Drives adopt_team_preset via the test bridge
 * with per-role overrides {aq_target_codebase: <dev_project_id>} for all 5
 * members ("set once, distributed to all"), then renames the team per repo.
 * Verification of pins + readiness is done separately (verify script).
 * Usage: PERSONAS_BASE=http://localhost:17321 node sdlc-team-perrepo.mjs */
import Database from 'better-sqlite3';
const BASE = process.env.PERSONAS_BASE || 'http://localhost:17320';
const DB = 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const ROLES = ['architect', 'reviewer', 'security', 'release', 'docs'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({}));
const query = (s) => post('/query', { selector: s });
const ev = (js) => post('/eval', { js });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
async function readBack(expr, max = 400) {
  await ev(`window.__rb=String(${expr}||'')`);
  let out = '';
  for (let off = 0; off < max; off += 220) {
    await ev(`(()=>{let n=document.getElementById('__rbn');if(!n){n=document.createElement('span');n.id='__rbn';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(window.__rb.slice(${off},${off + 220}))})()`);
    await sleep(30);
    const q = await query('#__rbn'); let s = ''; try { s = JSON.parse(q[0].text); } catch {} if (!s) break; out += s;
  }
  return out;
}
function devProjects() {
  const db = new Database(DB, { readonly: true });
  const r = db.prepare("SELECT id,name,root_path FROM dev_projects WHERE root_path LIKE '%xprice%' ORDER BY name").all();
  db.close(); return r;
}
function renameTeam(teamId, name) {
  const db = new Database(DB);
  db.prepare("UPDATE persona_teams SET name=?, updated_at=? WHERE id=?").run(name, new Date().toISOString(), teamId);
  db.close();
}

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  await ev('location.reload()'); await sleep(9000);
  const ready = await ev(`(()=>typeof window.__TEST__?.adoptTeamPreset==='function')()`);
  console.log('bridge adoptTeamPreset available:', JSON.stringify(ready));

  const projects = devProjects();
  console.log(`adopting ${projects.length} teams (one per repo)…`);
  for (const p of projects) {
    const overrides = {};
    for (const role of ROLES) overrides[role] = { aq_target_codebase: p.id };
    const call = `(async()=>{try{const r=await window.__TEST__.adoptTeamPreset('sdlc-lifecycle',${JSON.stringify(overrides)},null);window.__adopt=JSON.stringify(r)}catch(e){window.__adopt='ERR '+(e&&e.message||e)}})()`;
    await ev('window.__adopt=""'); await ev(call);
    let res = '';
    for (let i = 0; i < 45; i++) { await sleep(3000); res = await readBack('window.__adopt', 300); if (res) break; }
    let parsed = null; try { parsed = JSON.parse(res); } catch {}
    if (parsed?.teamId) {
      const teamName = `SDLC — ${p.name}`;
      renameTeam(parsed.teamId, teamName);
      console.log(`  ${p.name.padEnd(26)} → team ${parsed.teamId.slice(0, 8)} ok=${parsed.ok} failed=${parsed.failed} renamed "${teamName}"`);
    } else {
      console.log(`  ${p.name.padEnd(26)} → FAILED: ${res.slice(0, 120)}`);
    }
  }
  console.log('done adopting');
})().catch((e) => { console.error('DRIVER ERROR:', e.message); process.exit(1); });
