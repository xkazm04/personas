/** Re-adopt Dev Clone with the codebase devtools_project bound to ai-bookkeeper
 * (uses the new devtools-project-option testid), so build-verification delivers
 * value and setup_status clears. 1:1 DOM bridge. */
const BASE = 'http://localhost:17320';
const MODAL = '[aria-labelledby="adoption-matrix-title"]';
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
const curQ = () => readStr(inModal(`const h=r.querySelector('h3');return h?h.innerText:''`), 120);

(async () => {
  await evalJs('location.reload()'); await sleep(8000);
  await clickTestId('sidebar-design-reviews'); await sleep(900);
  await clickByText('All'); await sleep(300);
  await typeInto('[data-testid="template-search-input"]', 'Dev Clone'); await sleep(700);
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  const row = rows.find((r) => (r.text || '').includes('Dev Clone')) || rows[0];
  await clickTestId(row.testId); await sleep(500);
  await clickByText('Adopt'); await sleep(1200);
  // open the question card + walk to the codebase question
  await clickModal('QUESTION'); await sleep(700);
  let reached = false;
  for (let i = 0; i < 8; i++) { if (/registered codebase/i.test(await curQ())) { reached = true; break; } await clickModal('Next'); await sleep(450); }
  console.log('at codebase Q:', reached);
  // open the devtools_project dropdown, click the ai-bookkeeper OPTION (scoped testid)
  await clickModal('Select a project'); await sleep(900);
  const picked = await evalJs(`(()=>{const opts=Array.from(document.querySelectorAll('[data-testid^="devtools-project-option-"]'));const b=opts.find(x=>/bookkeeper/i.test(x.innerText||''))||opts[0];if(!b)return'no-option:'+opts.length;b.click();return'picked:'+(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24);})()`);
  console.log('pick option:', JSON.stringify(picked)); await sleep(800);
  const ddNow = await readStr(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/select a project|bookkeeper/i.test(x.innerText||''));return b?(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,28):'?'`), 120);
  console.log('dropdown now:', ddNow);
  // done with card → continue to build
  await clickModal('Done'); await sleep(700);
  const cont = await readStr(inModal(`return /CONTINUE TO BUILD/i.test(r.innerText)?'CONTINUE':'gated'`), 40);
  console.log('gate:', cont);
  if (!String(cont).includes('CONTINUE')) { console.log('still gated — codebase not bound; aborting build'); return; }
  console.log('Continue→', JSON.stringify(await clickModal('CONTINUE TO BUILD')));
  for (let i = 0; i < 100; i++) {
    await sleep(3000); if (!(await alive())) { console.log('APP DIED'); return; }
    const ready = JSON.stringify(await evalJs(inModal(`return Array.from(r.querySelectorAll('button')).some(b=>/^approve( anyway)?$/i.test((b.innerText||'').replace(/\\s+/g,' ').trim()))?'y':'n'`)));
    if (ready.includes('y')) { console.log(`[t+${i*3}s] gate ready`); break; }
    if (i % 4 === 0) console.log(`[t+${i*3}s] building...`);
  }
  const ap = await evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/^approve( anyway)?$/i.test((x.innerText||'').replace(/\\s+/g,' ').trim()));if(!b)return'no-approve';b.click();return(b.innerText||'').trim();`));
  console.log('Approve→', JSON.stringify(ap)); await sleep(3000);
  console.log('modal closed (PROMOTED)?', (await query(MODAL)).length === 0, '| alive?', await alive());
})().catch((e) => { console.error('READOPT ERROR:', e.message); process.exit(1); });
