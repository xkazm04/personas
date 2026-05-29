/**
 * Freeze-probe: drive the glyph adoption flow one step at a time, sampling
 * DOM node count + freeze-detector events + store-monitor between each action
 * to localize which step causes the DOM-growth / main-thread freeze that exits
 * the app. DOM-level bridge only (1:1 user path). See
 * docs/tests/autonomy-eval/autonomous-dev-team-adoption-test.md.
 */
const BASE = 'http://localhost:17320';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (selector) => call('/query', { selector });
const evalJs = (js) => call('/eval', { js });
const clickTestId = (test_id) => call('/click-testid', { test_id });

/** Run an expression in-page and read its JSON result back via a hidden marker node (eval has no return channel). */
async function probe(expr) {
  await evalJs(
    `(()=>{let n=document.getElementById('__probe');if(!n){n=document.createElement('span');n.id='__probe';n.style.cssText='position:fixed;left:-9999px;top:-9999px';document.body.appendChild(n);}` +
    `try{n.textContent=JSON.stringify(${expr});}catch(e){n.textContent=JSON.stringify({__err:String(e)});}})()`,
  );
  await sleep(120);
  const nodes = await query('#__probe');
  try { return JSON.parse(nodes[0]?.text || '{}'); } catch { return { __parse: nodes[0]?.text }; }
}

/** One snapshot: DOM node count, heap MB, worst recent freezes, store-monitor counts. */
const SNAP = `(()=>{const fd=window.__FREEZE_DETECTOR__;const ev=(fd&&fd.events?fd.events:[]).slice(-6).map(e=>e.duration+'ms@'+e.domNodes);` +
  `const m=window.__STORE_MONITOR__;const stores=m&&m.snapshot?m.snapshot():null;` +
  `const mem=performance&&performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null;` +
  `return{dom:document.querySelectorAll('*').length,heapMB:mem,freezes:ev,stores};})()`;

async function step(label, action) {
  if (action) await action();
  await sleep(900);
  const s = await probe(SNAP);
  console.log(`\n— ${label}`);
  console.log(`   dom=${s.dom}  heapMB=${s.heapMB}  freezes=[${(s.freezes || []).join(', ')}]`);
  if (s.stores) console.log(`   stores=${JSON.stringify(s.stores)}`);
  return s;
}

async function typeInto(selector, value) {
  return evalJs(
    `(()=>{const i=document.querySelector(${JSON.stringify(selector)});if(!i)return'no-input';` +
    `const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(value)});` +
    `i.dispatchEvent(new Event('input',{bubbles:true}));return'typed';})()`,
  );
}
async function clickButtonByText(text) {
  return evalJs(
    `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>((x.innerText||'').trim().includes(${JSON.stringify(text)})));if(!b)return false;b.click();return true;})()`,
  );
}

(async () => {
  const name = process.argv[2] || 'Dev Clone';
  await step('baseline (current view)');
  await step('open Templates gallery', async () => { await clickTestId('sidebar-design-reviews'); });
  await step(`search "${name}"`, async () => { await typeInto('[data-testid="template-search-input"]', name); });
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  const row = rows.find((r) => (r.text || '').includes(name)) || rows[0];
  console.log(`   matched row: ${row?.testId}`);
  await step('expand row (click)', async () => { if (row?.testId) await clickTestId(row.testId); });
  await step('click Adopt', async () => { await clickButtonByText('Adopt'); });
  // modal open — sample heavily here
  await step('modal settled (t+1)');
  await step('modal settled (t+2)');
  await step('modal settled (t+3)');
  console.log('\n=== done; if app still alive, modal is open ===');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
