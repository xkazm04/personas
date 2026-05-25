/** Probe the answer-card open/close cycle (where the app exits). 1:1 DOM bridge. */
const BASE = 'http://localhost:17320';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (selector) => call('/query', { selector });
const evalJs = (js) => call('/eval', { js });

async function probe(expr) {
  await evalJs(`(()=>{let n=document.getElementById('__probe');if(!n){n=document.createElement('span');n.id='__probe';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}try{n.textContent=JSON.stringify(${expr});}catch(e){n.textContent=JSON.stringify({__err:String(e)});}})()`);
  await sleep(120);
  const nodes = await query('#__probe');
  try { return JSON.parse(nodes[0]?.text || '{}'); } catch { return {}; }
}
const SNAP = `(()=>{const fd=window.__FREEZE_DETECTOR__;const ev=(fd&&fd.events?fd.events:[]).slice(-4).map(e=>e.duration+'ms@'+e.domNodes);const mem=performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null;return{dom:document.querySelectorAll('*').length,heapMB:mem,freezes:ev};})()`;

async function step(label, action) {
  if (action) await action();
  await sleep(800);
  const s = await probe(SNAP);
  console.log(`— ${label}\n   dom=${s.dom} heapMB=${s.heapMB} freezes=[${(s.freezes || []).join(', ')}]`);
  return s;
}
const clickByText = (text) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').includes(${JSON.stringify(text)})));if(!b)return false;b.click();return true;})()`);
const pressEsc = () => evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);

(async () => {
  await step('modal baseline');
  // open answer card on codebase question
  await step('open codebase question', async () => { const r = await clickByText('Which registered codebase'); console.log('   click→', JSON.stringify(r)); });
  await step('answer card open (settle)');
  // toggle the card open/close a few times — this is the reported exit trigger
  await step('press Escape (close card)', async () => { await pressEsc(); });
  await step('re-open same question', async () => { await clickByText('Which registered codebase'); });
  await step('Escape again', async () => { await pressEsc(); });
  await step('open a DIFFERENT question', async () => { await clickByText('How autonomous should'); });
  await step('switch back to codebase question', async () => { await clickByText('Which registered codebase'); });
  await step('final settle');
  console.log('=== survived ===');
})().catch((e) => { console.error('PROBE2 ERROR (app may have exited):', e.message); process.exit(1); });
