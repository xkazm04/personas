/** Live-app driver for the SDLC Delivery Team preset adoption (milestone task #4).
 * Drives the REAL UI 1:1: Templates → Presets tab → open the sdlc-lifecycle
 * card → Adopt all → watch per-member progress rows to done/failed. Verifies
 * nothing itself — SQLite inspection (verify-sdlc-adoption) is the source of truth.
 * App may bind :17321 (zombie on :17320); honors PERSONAS_BASE. */
const BASE = process.env.PERSONAS_BASE || 'http://localhost:17320';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({}));
const query = (s) => post('/query', { selector: s });
const ev = (js) => post('/eval', { js });
const clickTestId = (id) => post('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';

async function readBack(expr, max = 600) {
  await ev(`window.__rb=String(${expr}||'')`);
  let out = '';
  for (let off = 0; off < max; off += 220) {
    await ev(`(()=>{let n=document.getElementById('__rbn');if(!n){n=document.createElement('span');n.id='__rbn';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(window.__rb.slice(${off},${off + 220}))})()`);
    await sleep(30);
    const q = await query('#__rbn'); let s = ''; try { s = JSON.parse(q[0].text); } catch {} if (!s) break; out += s;
  }
  return out;
}
const exists = async (testid) => (await query(`[data-testid="${testid}"]`)).length > 0;

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  console.log('app alive at', BASE);

  // fresh state
  await ev('location.reload()'); await sleep(9000);

  // 1. Templates section
  const nav = await ev(`(()=>{try{return JSON.stringify(window.__TEST__.navigate('design-reviews'))}catch(e){return 'ERR '+e.message}})()`);
  console.log('navigate(design-reviews):', JSON.stringify(nav).slice(0, 120));
  await sleep(1500);

  // 2. Presets sub-tab
  await clickTestId('tab-presets'); await sleep(2500);
  console.log('preset-library-page present:', await exists('preset-library-page'));
  console.log('sdlc card present:', await exists('preset-card-sdlc-lifecycle'));

  // 3. open the SDLC preset card
  await clickTestId('preset-card-sdlc-lifecycle'); await sleep(2000);
  const modalUp = await exists('preset-preview-modal-sdlc-lifecycle');
  console.log('preview modal open:', modalUp);
  if (!modalUp) { console.log('FAILED: modal did not open'); process.exit(1); }

  // dump the member rows the modal shows (sanity: 5 members + names from schema)
  const rowsDump = await readBack(`(()=>[...document.querySelectorAll('[data-testid^=preset-row-]')].map(r=>r.getAttribute('data-testid').replace('preset-row-','')+':'+(r.innerText||'').replace(/\\s+/g,' ').slice(0,40)).join(' || '))()`, 600);
  console.log('member rows:', rowsDump);

  // 4. Adopt all (default — no customize); one click fires adopt_team_preset
  await clickTestId('preset-adopt-all-button'); console.log('clicked Adopt'); await sleep(2500);

  // 5. poll per-member row statuses until terminal (done/failed) or open-team CTA
  let last = '';
  for (let i = 0; i < 60; i++) {
    if (!(await alive())) { console.log(`[t+${i * 3}s] APP DIED`); process.exit(1); }
    const st = await readBack(`(()=>[...document.querySelectorAll('[data-testid^=preset-row-]')].map(r=>r.getAttribute('data-testid').replace('preset-row-','')+'='+ (r.getAttribute('data-status')||'?')).join(','))()`, 300);
    if (st !== last) { console.log(`[t+${i * 3}s] ${st}`); last = st; }
    const statuses = st.split(',').map(s => s.split('=')[1]);
    const terminal = statuses.length > 0 && statuses.every(s => s === 'done' || s === 'failed');
    const openTeam = await exists('preset-open-team-button');
    if (terminal || openTeam) { console.log(`DONE (open-team CTA=${openTeam})`); break; }
    await sleep(3000);
  }

  // capture footer hint + any failure text
  const footer = await readBack(`(()=>{const f=[...document.querySelectorAll('p')].map(p=>p.innerText).filter(t=>/member|adopt|landed|failed/i.test(t));return f.join(' | ')})()`, 300);
  console.log('footer:', footer.slice(0, 200));
  const fails = await readBack(`(()=>[...document.querySelectorAll('[data-testid^=preset-row-][data-status=failed]')].map(r=>r.innerText.replace(/\\s+/g,' ')).join(' || '))()`, 400);
  if (fails) console.log('FAILURES:', fails);
  console.log('done');
})().catch((e) => { console.error('DRIVER ERROR:', e.message); process.exit(1); });
