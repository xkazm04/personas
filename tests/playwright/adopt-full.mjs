/** Full glyph adoption end-to-end for one template, scoped + paced. 1:1 DOM bridge.
 * Usage: node tests/playwright/adopt-full.mjs "Dev Clone" */
const BASE = 'http://localhost:17320';
const MODAL = '[aria-labelledby="adoption-matrix-title"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (s) => call('/query', { selector: s });
const evalJs = (js) => call('/eval', { js });
const clickTestId = (id) => call('/click-testid', { test_id: id });
const typeInto = (s, v) => evalJs(`(()=>{const i=document.querySelector(${JSON.stringify(s)});if(!i)return 0;const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
// global click (gallery, before modal exists) — safe, never a close affordance
const clickByText = (t) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return false;b.click();return true;})()`);
// MODAL-SCOPED click (never matches the titlebar Close)
const clickModal = (t) => evalJs(`(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});if(!r)return'no-modal';const b=Array.from(r.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return'no-btn';b.click();return'clicked';})()`);
const closeCard = () => evalJs(`(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});if(!r)return'no-modal';const b=r.querySelector('[aria-label="Close"]');if(!b)return'no-close';b.click();return'closed';})()`);
async function read(expr){await evalJs(`(()=>{let n=document.getElementById('__af');if(!n){n=document.createElement('span');n.id='__af';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(${expr});})()`);await sleep(100);const n=await query('#__af');try{return JSON.parse(n[0].text)}catch{return{raw:n[0]?.text?.slice(0,300)}}}
const modalButtons = () => read(`(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});if(!r)return[];return Array.from(r.querySelectorAll('button')).filter(b=>b.offsetParent!==null).map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()).filter(Boolean);})()`);
const alive = async () => (await fetch(BASE + '/health').then(r => r.json()).catch(() => null))?.status === 'ok';

(async () => {
  const name = process.argv[2] || 'Dev Clone';
  console.log(`\n=== Full adoption: ${name} ===`);
  await clickTestId('sidebar-design-reviews'); await sleep(800);
  await typeInto('[data-testid="template-search-input"]', name); await sleep(700);
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  const row = rows.find((r) => (r.text || '').includes(name)) || rows[0];
  if (!row?.testId) { console.log('NO ROW'); return; }
  await clickTestId(row.testId); await sleep(500);
  await clickByText('Adopt'); await sleep(1000);
  console.log('modal open:', JSON.stringify(await modalButtons()));
  // open first unanswered question via sigil center
  await clickModal('QUESTION TO ANSWER'); await sleep(700);
  // select codebase project
  await clickByText('Select a project'); await sleep(500);
  await clickByText('ai-bookkeeper'); await sleep(700);
  console.log('after codebase select:', JSON.stringify(await modalButtons()));
  // close the answer card (SCOPED — not the titlebar)
  console.log('closeCard→', JSON.stringify(await closeCard())); await sleep(700);
  console.log('alive after closeCard?', await alive());
  console.log('modal after close:', JSON.stringify(await modalButtons()));
  // look for Continue to build
  const btns = await modalButtons();
  const cont = btns.find((b) => /continue|build/i.test(b));
  console.log('continue CTA:', cont || 'NONE');
})().catch((e) => { console.error('ADOPT-FULL ERROR:', e.message); process.exit(1); });
