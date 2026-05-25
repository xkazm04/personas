/** Reopen QA Guardian, walk to the codebase question, dump every element in the card. */
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
async function readStr(expr, max = 3000) { await evalJs(`window.__s=String(${expr}||'')`); const out = []; for (let off = 0; off < max; off += 240) { await evalJs(`(()=>{let n=document.getElementById('__c');if(!n){n=document.createElement('span');n.id='__c';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(window.__s.slice(${off},${off+240}))})()`); await sleep(35); const n = await query('#__c'); let s = ''; try { s = JSON.parse(n[0].text); } catch {} if (!s) break; out.push(s); } return out.join(''); }
const curQ = () => readStr(inModal(`const h=r.querySelector('h3');return h?h.innerText:''`), 200);

(async () => {
  // cancel + reopen fresh
  await evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/cancel/i.test(x.innerText||''));if(b)b.click();`)); await sleep(700);
  await clickTestId('sidebar-design-reviews'); await sleep(800);
  await clickByText('All'); await sleep(300);
  await typeInto('[data-testid="template-search-input"]', 'QA Guardian'); await sleep(700);
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  await clickTestId((rows.find((r) => (r.text || '').includes('QA Guardian')) || rows[0]).testId); await sleep(500);
  await clickByText('Adopt'); await sleep(1100);
  await clickModal('QUESTION'); await sleep(700);
  // Next until we reach the codebase question (max 8)
  for (let i = 0; i < 8; i++) {
    const q = await curQ();
    if (/registered codebase/i.test(q)) { console.log('AT codebase question:', q.slice(0, 70)); break; }
    await clickModal('Next'); await sleep(500);
  }
  // dump every element in the card's question region (the panel containing the h3)
  const dump = await readStr(inModal(`
    const h=r.querySelector('h3'); let card=h; for(let i=0;i<6&&card.parentElement;i++){card=card.parentElement;}
    const els=Array.from(card.querySelectorAll('*')).filter(e=>e.offsetParent!==null && (e.tagName==='BUTTON'||e.tagName==='INPUT'||e.tagName==='SELECT'||e.tagName==='TEXTAREA'||e.getAttribute('role')||e.getAttribute('data-testid')));
    return els.slice(0,30).map(e=>e.tagName.toLowerCase()+(e.getAttribute('role')?'['+e.getAttribute('role')+']':'')+(e.getAttribute('data-testid')?'#'+e.getAttribute('data-testid'):'')+(e.type?'('+e.type+')':'')+(e.getAttribute('aria-checked')?' chk='+e.getAttribute('aria-checked'):'')+' "'+(e.innerText||e.value||'').replace(/\\s+/g,' ').trim().slice(0,30)+'"').join('\\n');
  `), 3000);
  console.log('=== codebase card elements ===\n' + dump);
})().catch((e) => { console.error('INSPECT ERROR:', e.message); process.exit(1); });
