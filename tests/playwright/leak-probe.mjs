/** Leak probe: repeat the real navigation cycle (Overview↔Templates, open/close
 * adoption modal) N times, watching heap + DOM for monotonic growth. The prior
 * crash had heap at 147MB climbing — a slow leak over the long 7-template test
 * is the leading crash hypothesis. 1:1 DOM bridge. */
const BASE = 'http://localhost:17320';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (selector) => call('/query', { selector });
const evalJs = (js) => call('/eval', { js });
const clickTestId = (id) => call('/click-testid', { test_id: id });

async function probe(expr) {
  await evalJs(`(()=>{let n=document.getElementById('__probe');if(!n){n=document.createElement('span');n.id='__probe';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}try{n.textContent=JSON.stringify(${expr});}catch(e){n.textContent=JSON.stringify({__err:String(e)});}})()`);
  await sleep(100);
  const nodes = await query('#__probe');
  try { return JSON.parse(nodes[0]?.text || '{}'); } catch { return {}; }
}
const SNAP = `(()=>{const fd=window.__FREEZE_DETECTOR__;const sev=(fd&&fd.events?fd.events:[]).filter(e=>e.duration>200).length;const mem=performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null;` +
  `const ls=(()=>{try{return JSON.parse(localStorage.getItem('__store_monitor')||'null')}catch{return null}})();` +
  `return{dom:document.querySelectorAll('*').length,heapMB:mem,freezeCount:fd&&fd.events?fd.events.length:0,severeFreezes:sev};})()`;
const typeInto = (sel, v) => evalJs(`(()=>{const i=document.querySelector(${JSON.stringify(sel)});if(!i)return 0;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
const clickByText = (t) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').includes(${JSON.stringify(t)})));if(!b)return false;b.click();return true;})()`);

(async () => {
  const N = Number(process.argv[2]) || 12;
  const base = await probe(SNAP);
  console.log(`baseline: dom=${base.dom} heapMB=${base.heapMB} freezes=${base.freezeCount} severe=${base.severeFreezes}`);
  for (let i = 1; i <= N; i++) {
    await clickTestId('sidebar-overview'); await sleep(500);
    await clickTestId('sidebar-design-reviews'); await sleep(600);
    await typeInto('[data-testid="template-search-input"]', 'Dev Clone'); await sleep(600);
    const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
    const row = rows.find((r) => (r.text || '').includes('Dev Clone')) || rows[0];
    if (row?.testId) { await clickTestId(row.testId); await sleep(400); }
    await clickByText('Adopt'); await sleep(700);
    await clickByText('Which registered codebase'); await sleep(400);   // open answer card
    await clickByText('Cancel'); await sleep(400);                       // close modal
    const s = await probe(SNAP);
    console.log(`iter ${String(i).padStart(2)}: dom=${s.dom} heapMB=${s.heapMB} freezes=${s.freezeCount} severe=${s.severeFreezes}`);
    if (s.__err || s.heapMB == null) { console.log('   probe degraded:', JSON.stringify(s)); }
  }
  console.log('=== survived all iterations ===');
})().catch((e) => { console.error('LEAK PROBE ERROR (app may have exited):', e.message); process.exit(1); });
