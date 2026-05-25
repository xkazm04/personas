/** Generic glyph auto-adopter: navigates to a template, auto-answers its
 * unanswered questions (codebase → ai-bookkeeper, source-control → a GitHub PAT,
 * generic dropdowns/radios → first real option, text → a default), then
 * Continue to build → Approve. 1:1 DOM bridge, all clicks scoped to the modal
 * (never the titlebar). Usage: node tests/playwright/auto-adopt.mjs "QA Guardian"
 */
const BASE = 'http://localhost:17320';
const MODAL = '[aria-labelledby="adoption-matrix-title"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const query = (s) => call('/query', { selector: s });
const evalJs = (js) => call('/eval', { js });
const clickTestId = (id) => call('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const typeInto = (s, v) => evalJs(`(()=>{const i=document.querySelector(${JSON.stringify(s)});if(!i)return 0;const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
const clickByText = (t) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return false;b.click();return true;})()`);
// scoped helpers
const inModal = (body) => `(()=>{const r=document.querySelector(${JSON.stringify(MODAL)});if(!r)return'no-modal';${body}})()`;
const clickModal = (t) => evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})));if(!b)return'no-btn';b.click();return'clicked';`));
async function readStr(expr, max = 2000) { await evalJs(`window.__s=String(${expr}||'')`); const out = []; for (let off = 0; off < max; off += 240) { await evalJs(`(()=>{let n=document.getElementById('__c');if(!n){n=document.createElement('span');n.id='__c';n.style.cssText='position:fixed;left:-9999px';document.body.appendChild(n);}n.textContent=JSON.stringify(window.__s.slice(${off},${off+240}))})()`); await sleep(35); const n = await query('#__c'); let s = ''; try { s = JSON.parse(n[0].text); } catch {} if (!s) break; out.push(s); } return out.join(''); }
const modalText = () => readStr(inModal(`return r.innerText`), 2500);
const currentQuestion = () => readStr(inModal(`const h=r.querySelector('h3');return h?h.innerText:''`), 300);

/** Answer the currently-open question card — CHOICE-ONLY (never types into
 * defaulted number/select/text fields). Skips questions already answered.
 * Returns a label of the action. */
async function answerCard() {
  const q = (await currentQuestion()).toLowerCase();
  // 1) Dev-Clone-style project dropdown — only if still unpicked (placeholder shown)
  const ddState = await evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/select a project|^select\\.\\.\\.$|pick a project/i.test((x.innerText||'').trim()));return b?'unpicked':'none';`));
  if (JSON.stringify(ddState).includes('unpicked')) {
    await evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>/select a project|^select\\.\\.\\.$|pick a project/i.test((x.innerText||'').trim()));if(b)b.click();`));
    await sleep(500);
    const picked = await clickByText('ai-bookkeeper');
    return `dropdown→ai-bookkeeper(${JSON.stringify(picked).includes('true') ? 'ok' : 'miss'})`;
  }
  // 2) radio options — only if none already selected (aria-checked)
  const radioInfo = await readStr(inModal(`const rs=Array.from(r.querySelectorAll('[role=radio]'));const anyChecked=rs.some(e=>e.getAttribute('aria-checked')==='true'||e.getAttribute('data-state')==='checked');return JSON.stringify({n:rs.length,checked:anyChecked,labels:rs.map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,28))});`), 1200);
  let ri; try { ri = JSON.parse(radioInfo); } catch { ri = { n: 0 }; }
  if (ri.n > 0 && !ri.checked) {
    const list = ri.labels;
    let want;
    if (/codebase|tests against|analyze and|repository|\brepo\b/.test(q)) want = list.find((t) => /bookkeeper|codebase/i.test(t));
    else if (/credential|source.control|review prs|\bgit\b|pull request/.test(q)) want = list.find((t) => /github/i.test(t));
    want = want || list[0];
    const idx = list.indexOf(want);
    await evalJs(inModal(`const rs=Array.from(r.querySelectorAll('[role=radio]'));if(rs[${idx}])rs[${idx}].click();`));
    return `radio[${idx}]→${(want || '').slice(0, 30)}`;
  }
  if (ri.n > 0 && ri.checked) return 'radio(already-set)';
  return 'skip(default/number/text)';
}

async function navOpen(name) {
  await clickTestId('sidebar-design-reviews'); await sleep(900);
  await clickByText('All'); await sleep(300);
  await typeInto('[data-testid="template-search-input"]', ''); await sleep(300);
  await typeInto('[data-testid="template-search-input"]', name); await sleep(700);
  const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
  const row = rows.find((r) => (r.text || '').includes(name)) || rows[0];
  if (!row?.testId) throw new Error('row not found: ' + name);
  await clickTestId(row.testId); await sleep(500);
  await clickByText('Adopt'); await sleep(1100);
}

(async () => {
  const name = process.argv[2] || 'QA Guardian';
  console.log(`\n=== AUTO-ADOPT: ${name} ===`);
  await navOpen(name);
  let txt = await modalText();
  if (txt === 'no-modal') { console.log('modal did not open'); return; }
  // Outer loop: each capability tab may hold its own question card.
  for (let cap = 0; cap < 6; cap++) {
    txt = await modalText();
    if (/CONTINUE TO BUILD/i.test(txt)) { console.log(`all answered → CONTINUE TO BUILD`); break; }
    const open = await clickModal('QUESTION'); // open first unanswered card
    await sleep(600);
    if (JSON.stringify(open).includes('no-btn')) { console.log(`no QUESTION button (cap ${cap}); head: ${txt.slice(0, 100)}`); break; }
    // Walk every question in this card via Next, answering unanswered choice qs.
    let lastQ = '';
    for (let step = 0; step < 10; step++) {
      const did = await answerCard(); await sleep(400);
      const qNow = (await currentQuestion()).slice(0, 40);
      console.log(`  cap${cap} step${step}: ${did}  | ${qNow}`);
      if (!(await alive())) { console.log('APP DIED during answering'); return; }
      const nextState = JSON.stringify(await clickModal('Next'));
      if (nextState.includes('no-btn') || qNow === lastQ) break; // end of card / stuck
      lastQ = qNow;
      await sleep(500);
    }
    // close the card (scoped) to return to the sigil view
    await evalJs(inModal(`const b=r.querySelector('[aria-label="Close"]');if(b)b.click();`)); await sleep(600);
  }
  // build
  console.log('Continue→', JSON.stringify(await clickModal('CONTINUE TO BUILD')));
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    if (!(await alive())) { console.log('APP DIED during build'); return; }
    const t = await modalText();
    if (/TEST COMPLETE|Approve Anyway|Approve/i.test(t)) { console.log(`[t+${i*3}s] build gate ready`); break; }
    if (i % 3 === 0) console.log(`[t+${i*3}s] building...`);
  }
  console.log('Approve→', JSON.stringify(await clickModal('Approve Anyway'))); await sleep(2500);
  const modalGone = (await query(MODAL)).length === 0;
  console.log('modal closed (promoted)?', modalGone, ' alive?', await alive());
})().catch((e) => { console.error('AUTO-ADOPT ERROR:', e.message); process.exit(1); });
