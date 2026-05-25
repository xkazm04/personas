/** Observe a template's question sequence: open card, dump each question's text +
 * input rendering (dropdown/radio/number/text), step via Next. Read-only-ish. */
const BASE = 'http://localhost:17320';
const MODAL = '[aria-labelledby="adoption-matrix-title"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (s) => call('/query', { selector: s });
const evalJs = (js) => call('/eval', { js });
const clickTestId = (id) => call('/click-testid', { test_id: id });
const typeInto = (s, v) => evalJs(`(()=>{const i=document.querySelector(${JSON.stringify(s)});if(!i)return 0;const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
const clickByText = (t) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return false;b.click();return true;})()`);
const inModal = (body) => `(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});if(!r)return'no-modal';${body}})()`;
const clickModal = (t) => evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return'no-btn';b.click();return'clicked';`));
async function readStr(expr, max = 1200) { await evalJs(`window.__s=String(${expr}||'')`); const out = []; for (let off = 0; off < max; off += 240) { await evalJs(`(()=>{let n=document.getElementById('__c');if(!n){n=document.createElement('span');n.id='__c';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(window.__s.slice(${off},${off+240}))})()`); await sleep(35); const n = await query('#__c'); let s = ''; try { s = JSON.parse(n[0].text); } catch {} if (!s) break; out.push(s); } return out.join(''); }

async function describeCard() {
  const q = await readStr(inModal(`const h=r.querySelector('h3');return h?h.innerText:'(no h3)'`), 200);
  const radios = await readStr(inModal(`return Array.from(r.querySelectorAll('[role=radio]')).map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,28)).join(' | ')`), 800);
  const ddTrigger = await readStr(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/select a project|select\\.\\.\\.|choose|pick a project/i.test(x.innerText||''));return b?(b.innerText||'').trim().slice(0,30):''`), 100);
  const inputs = await readStr(inModal(`return Array.from(r.querySelectorAll('input:not([type=hidden]):not([data-testid=template-search-input]),textarea,select')).map(e=>e.tagName.toLowerCase()+'['+(e.type||'')+']='+JSON.stringify((e.value||'').slice(0,20))).join(' | ')`), 400);
  const nextDisabled = await readStr(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/^next$/i.test((x.innerText||'').trim()));return b?String(b.disabled):'no-next'`), 30);
  return { q, radios, ddTrigger, inputs, nextDisabled };
}

(async () => {
  const name = process.argv[2] || 'QA Guardian';
  // cancel any open modal first (scoped)
  await evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/cancel/i.test(x.innerText||''));if(b)b.click();`)); await sleep(700);
  await clickTestId('sidebar-design-reviews'); await sleep(800);
  await clickByText('All'); await sleep(300);
  await typeInto('[data-testid="template-search-input"]', name); await sleep(700);
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  const row = rows.find((r) => (r.text || '').includes(name)) || rows[0];
  await clickTestId(row.testId); await sleep(500);
  await clickByText('Adopt'); await sleep(1100);
  console.log(`=== ${name} ===`);
  await clickModal('QUESTION'); await sleep(700); // open first unanswered
  for (let i = 0; i < 8; i++) {
    const d = await describeCard();
    console.log(`\nQ${i}: ${d.q}`);
    console.log(`   radios: [${d.radios}]`);
    console.log(`   dropdown: "${d.ddTrigger}"  inputs: [${d.inputs}]  next.disabled=${d.nextDisabled}`);
    if (d.nextDisabled === 'no-next' || d.nextDisabled === 'true') { console.log('   (Next gone/disabled — end of capability)'); break; }
    await clickModal('Next'); await sleep(600);
  }
})().catch((e) => { console.error('WALK ERROR:', e.message); process.exit(1); });
