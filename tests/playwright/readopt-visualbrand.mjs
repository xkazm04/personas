/** Re-adopt Visual Brand Asset Factory choosing brief_mode = "paste my own
 * design.md" and pasting a real brief into the aq_brief_content textarea, to
 * validate C: the run uses the pasted brief verbatim instead of runtime codebase
 * extraction (no "design.md Brief Not Accessible" halt). 1:1 glyph UI via :17320. */
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:17320';
const MODAL = '[aria-labelledby="adoption-matrix-title"]';
const BRIEF = readFileSync(new URL('./fixtures/ledgerline-design.md', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (s) => call('/query', { selector: s });
const evalJs = (js) => call('/eval', { js });
const clickTestId = (id) => call('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const inModal = (body) => `(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});if(!r)return'no-modal';${body}})()`;
const clickByText = (t) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return'no';b.click();return'yes';})()`);
const clickModal = (t) => evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return'no-btn';b.click();return'clicked';`));
const typeInto = (s, v) => evalJs(`(()=>{const i=document.querySelector(${JSON.stringify(s)});if(!i)return 0;const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
async function readStr(expr, max = 300) { await evalJs(`window.__s=String(${expr}||'')`); const out = []; for (let off = 0; off < max; off += 240) { await evalJs(`(()=>{let n=document.getElementById('__c');if(!n){n=document.createElement('span');n.id='__c';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(window.__s.slice(${off},${off+240}))})()`); await sleep(35); const n = await query('#__c'); let s = ''; try { s = JSON.parse(n[0].text); } catch {} if (!s) break; out.push(s); } return out.join(''); }
const curQ = () => readStr(inModal(`const h=r.querySelector('h3');return h?h.innerText:''`), 140);
// click an option (button / role=radio / pill) inside the modal whose text matches
const pickOption = (re) => evalJs(inModal(`const els=Array.from(r.querySelectorAll('button,[role=radio],[role=option]'));const b=els.find(x=>${re}.test((x.innerText||'').replace(/\\s+/g,' ').trim()));if(!b)return'no-opt';b.click();return'picked:'+(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40);`));
// set a textarea inside the modal to a value
const fillTextarea = (val) => evalJs(inModal(`const ta=r.querySelector('textarea');if(!ta)return'no-textarea';const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,${JSON.stringify(val)});ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));return 'filled:'+ta.value.length;`));

(async () => {
  await evalJs('location.reload()'); await sleep(8000);
  await clickTestId('sidebar-design-reviews'); await sleep(900);
  await clickByText('All'); await sleep(300);
  await typeInto('[data-testid="template-search-input"]', 'Visual Brand'); await sleep(700);
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  const row = rows.find((r) => /visual brand/i.test(r.text || '')) || rows[0];
  if (!row) { console.log('NO Visual Brand row'); return; }
  await clickTestId(row.testId); await sleep(500);
  await clickByText('Adopt'); await sleep(1200);
  await clickModal('QUESTION'); await sleep(900);
  // ACTION-BASED walk (robust to racy h3 reads): at each step try every special
  // action; each only succeeds on the card where its control is present.
  let setMode = false, setContent = false, setImg = false;
  for (let i = 0; i < 16; i++) {
    if (!setMode) { const r = await pickOption('/paste my own/i'); if (typeof r === 'string' && r.startsWith('picked')) { setMode = true; console.log('step' + i + ' brief_mode →', JSON.stringify(r)); await sleep(500); } }
    if (!setContent) { const r = await fillTextarea(BRIEF); if (typeof r === 'string' && r.startsWith('filled')) { setContent = true; console.log('step' + i + ' brief_content →', JSON.stringify(r)); await sleep(500); } }
    if (!setImg) { const r = await pickOption('/leonardo/i'); if (typeof r === 'string' && r.startsWith('picked')) { setImg = true; console.log('step' + i + ' image_model →', JSON.stringify(r)); await sleep(400); } }
    await clickModal('Next'); await sleep(480);
  }
  console.log('setMode/setContent/setImg:', setMode, setContent, setImg);
  await clickModal('Done'); await sleep(700);
  const cont = await readStr(inModal(`return /CONTINUE TO BUILD/i.test(r.innerText)?'CONTINUE':'gated'`), 40);
  console.log('gate:', cont);
  if (!String(cont).includes('CONTINUE')) {
    // surface what's still required
    console.log('remaining:', (await readStr(inModal(`return r.innerText.replace(/\\s+/g,' ').slice(0,400)`), 400)));
    return;
  }
  console.log('Continue→', JSON.stringify(await clickModal('CONTINUE TO BUILD')));
  const READY = inModal(`return Array.from(r.querySelectorAll('button')).some(b=>/approve|promote/i.test((b.innerText||'').replace(/\\s+/g,' ').trim()))?'y':'n'`);
  let ready = false;
  for (let i = 0; i < 150; i++) {
    await sleep(3000); if (!(await alive())) { console.log('APP DIED'); return; }
    if (JSON.stringify(await evalJs(READY)).includes('y')) { console.log(`[t+${i*3}s] gate ready`); ready = true; break; }
    if (i % 5 === 0) console.log(`[t+${i*3}s] building...`);
  }
  if (!ready) console.log('no promote button (timeout)');
  const ap = await evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/approve|promote/i.test((x.innerText||'').replace(/\\s+/g,' ').trim()));if(!b)return'no-approve';b.click();return(b.innerText||'').replace(/\\s+/g,' ').trim();`));
  console.log('Approve/Promote→', JSON.stringify(ap)); await sleep(3500);
  console.log('modal closed (PROMOTED)?', (await query(MODAL)).length === 0, '| alive?', await alive());
})().catch((e) => { console.error('READOPT-VB ERROR:', e.message); process.exit(1); });
