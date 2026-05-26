/** Live test: drive Athena's chat to set up a Dev Tools project for a repo.
 * Sends a "set up dev project for <path>" message → waits for her register_project
 * approval card → approves it → the handler creates the real dev_projects row +
 * auto-launches a context scan. Verifies the dev_projects row appears.
 * Usage: PERSONAS_BASE=http://localhost:17321 node athena-devproject.mjs "<name>" "<path>" */
import Database from 'better-sqlite3';
const BASE = process.env.PERSONAS_BASE || 'http://localhost:17320';
const DB = 'C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db';
const [, , NAME, REPO_PATH] = process.argv;
if (!REPO_PATH) { console.error('usage: <name> <path>'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({}));
const query = (s) => post('/query', { selector: s });
const ev = (js) => post('/eval', { js });
const clickTestId = (id) => post('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const exists = async (sel) => (await query(sel)).length > 0;
function devProjectRow(pathFrag) {
  const db = new Database(DB, { readonly: true });
  const r = db.prepare("SELECT id,name,root_path,status FROM dev_projects WHERE root_path LIKE ? ORDER BY created_at DESC LIMIT 1").get('%' + pathFrag + '%');
  db.close(); return r || null;
}
const frag = REPO_PATH.split(/[\\/]/).filter(Boolean).pop();

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  console.log('app alive at', BASE, '| repo frag:', frag);

  await ev('location.reload()'); await sleep(9000);
  // open Athena's chat panel (the real CompanionPanel overlay, not the plugins tab)
  const nav = await ev(`(()=>{try{return JSON.stringify(window.__TEST__.openCompanion())}catch(e){return 'ERR '+e.message}})()`);
  await sleep(2000);
  console.log('companion panel present:', await exists('[data-testid="companion-panel"]'), '| open:', JSON.stringify(nav).slice(0, 60));

  const intent = `Set up a Dev Tools project for the repository at ${REPO_PATH.replace(/\\/g, '/')} named "${NAME}", then start a context scan so a team can work on it.`;
  // fill the composer (textarea) + send
  await ev(`(()=>{const ta=document.querySelector('[data-testid=companion-composer]');if(!ta)return 0;const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;s.call(ta,${JSON.stringify(intent)});ta.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await sleep(600);
  await clickTestId('companion-send');
  console.log('sent:', intent.slice(0, 80) + '…');

  // poll for the register_project approval card (Athena's LLM turn → op)
  let approved = false;
  for (let i = 0; i < 40; i++) {
    await sleep(4000);
    if (!(await alive())) { console.log(`[t+${i * 4}s] APP DIED`); process.exit(1); }
    if (await exists('[data-companion-approval-action="register_project"]')) {
      console.log(`[t+${i * 4}s] register_project approval card appeared`);
      const r = await ev(`(()=>{const c=document.querySelector('[data-companion-approval-action="register_project"]');if(!c)return 'gone';const b=c.querySelector('button');if(b){b.click();return 'clicked-approve';}return 'no-btn';})()`);
      console.log('  approve:', JSON.stringify(r).slice(0, 40));
      approved = true; break;
    }
    // surface any other approval action Athena emitted (debug)
    const other = await query('[data-companion-approval-action]');
    if (other.length > 0 && i % 3 === 2) {
      const acts = await ev(`(()=>[...document.querySelectorAll('[data-companion-approval-action]')].map(e=>e.getAttribute('data-companion-approval-action')).join(','))()`);
      console.log(`[t+${i * 4}s] approvals present: ${JSON.stringify(acts).slice(0, 80)}`);
    }
  }
  if (!approved) { console.log('NO register_project card — checking what Athena said'); }

  // verify the dev_projects row landed
  let row = null;
  for (let i = 0; i < 12; i++) { await sleep(3000); row = devProjectRow(frag); if (row) break; }
  if (row) {
    console.log(`PASS: dev_projects row → id=${row.id.slice(0, 8)} name="${row.name}" status=${row.status} root=${row.root_path}`);
  } else {
    console.log('FAIL: no dev_projects row for', frag);
  }
})().catch((e) => { console.error('DRIVER ERROR:', e.message); process.exit(1); });
