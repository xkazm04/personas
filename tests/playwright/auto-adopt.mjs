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
  // 3) free-text questions — a genuine <textarea> or text <input> (never a
  // number/select). Type a sensible generic answer only when EMPTY, so we
  // unblock required free-text config questions without clobbering defaults.
  const textState = await readStr(inModal(`const i=r.querySelector('textarea, input[type="text"]:not([data-testid="template-search-input"])');if(!i)return 'none';return (i.value&&i.value.trim())?'filled':'empty';`), 30);
  if (textState.includes('empty')) {
    let val = 'all relevant sources';
    if (/email|sender/i.test(q)) val = 'all senders';
    else if (/signal|profil|market|competitor/i.test(q)) val = 'pricing changes, feature launches, competitor mentions';
    else if (/url|domain|site/i.test(q)) val = 'all configured sources';
    await evalJs(inModal(`const i=r.querySelector('textarea, input[type="text"]:not([data-testid="template-search-input"])');if(i){const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i),'value').set;set.call(i,${JSON.stringify(val)});i.dispatchEvent(new Event('input',{bubbles:true}));}`));
    return `text→"${val.slice(0, 24)}"`;
  }
  if (textState.includes('filled')) return 'text(already-filled)';
  // 4) dynamic SelectPills (async-loaded option buttons) — only for questions
  // whose source is dynamic (codebase / repository / project / channel). Poll
  // for the option to appear, then click the pill matching intent.
  if (/codebase|repository|\brepo\b|registered|project|channel|which .* should/.test(q)) {
    const ctrlRe = '^(next|previous|disable|disabled|cancel|done|retry|add credential|close)$';
    for (let attempt = 0; attempt < 6; attempt++) {
      const pillsRaw = await readStr(inModal(`return Array.from(r.querySelectorAll('button')).filter(b=>b.offsetParent!==null&&(b.innerText||'').trim()&&!new RegExp(${JSON.stringify(ctrlRe)},'i').test((b.innerText||'').replace(/\\s+/g,' ').trim())&&!/\\d\\/\\d/.test(b.innerText||'')&&!/QUESTION|CONTINUE TO BUILD/i.test(b.innerText||'')).map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,32)).join(' || ')`), 1500);
      // Exclude the question-navigation buttons (their text IS the question,
      // ends with '?' or repeats the h3) — only real option pills remain.
      const pills = pillsRaw.split(' || ').filter((t) => t && !/\?$/.test(t) && !/which .* should/i.test(t));
      if (pills.length) {
        const isCodebase = /codebase|tests against|analyze|repository|\brepo\b|registered/.test(q);
        // Match the codebase OPTION by the connector name 'bookkeeper' (the
        // question text never contains it), never a blind first-pill fallback.
        const want = isCodebase ? pills.find((t) => /bookkeeper/i.test(t)) : pills[0];
        if (!want) { await sleep(800); continue; }
        await evalJs(inModal(`const b=Array.from(r.querySelectorAll('button')).find(x=>((x.innerText||'').replace(/\\s+/g,' ').trim().slice(0,32)===${JSON.stringify(want)}));if(b)b.click();`));
        return `pill→${want.slice(0, 28)}`;
      }
      await sleep(800); // wait for async dynamic options
    }
    return 'pill(none-loaded)';
  }
  return 'skip(default/number/text)';
}

async function navOpen(name) {
  for (let tryN = 0; tryN < 2; tryN++) {
    await clickTestId('sidebar-design-reviews'); await sleep(900);
    await clickByText('All'); await sleep(300);
    await typeInto('[data-testid="template-search-input"]', ''); await sleep(300);
    await typeInto('[data-testid="template-search-input"]', name); await sleep(700);
    const rows = (await query('[data-testid^="template-row-"]')).filter((n) => n.visible);
    const row = rows.find((r) => (r.text || '').includes(name)) || rows[0];
    if (!row?.testId) { console.log('row not found, retry'); continue; }
    await clickTestId(row.testId); await sleep(700);
    // poll for the Adopt CTA to render inside the expanded row, then click it
    let clicked = false;
    for (let i = 0; i < 8; i++) {
      const r = await clickByText('Adopt');
      if (JSON.stringify(r).includes('true')) { clicked = true; break; }
      await sleep(400);
    }
    if (!clicked) { console.log('Adopt CTA not found, retry'); continue; }
    // verify the modal opened
    for (let i = 0; i < 8; i++) { await sleep(500); if ((await query(MODAL)).length > 0) return true; }
    console.log('modal did not open after Adopt, retry');
  }
  throw new Error('could not open adoption modal for ' + name);
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
    // Return to the sigil view via the answer card's footer "Done" button.
    // NOT [aria-label="Close"] — the modal's own top-right X shares that label
    // and clicking it closes the WHOLE modal (the no-modal bug). "Done" closes
    // only the card.
    const doneClick = JSON.stringify(await clickModal('Done'));
    if (doneClick.includes('no-btn')) {
      // Fallback: the answer card's own close X is the LAST [aria-label="Close"]
      // in the modal (the modal's outer X is first) — pick the last.
      await evalJs(inModal(`const xs=r.querySelectorAll('[aria-label="Close"]');const b=xs[xs.length-1];if(b&&xs.length>1)b.click();`));
    }
    await sleep(600);
  }
  // build — the test gate can take ~120-150s (longer than Dev Clone), so poll
  // generously and only treat an actual "Approve Anyway" button as ready (the
  // TESTING phase has no Approve button; matching bare "Approve" mis-fired).
  console.log('Continue→', JSON.stringify(await clickModal('CONTINUE TO BUILD')));
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    if (!(await alive())) { console.log('APP DIED during build'); return; }
    const ready = JSON.stringify(await evalJs(inModal(`return Array.from(r.querySelectorAll('button')).some(b=>/approve anyway/i.test(b.innerText||''))?'yes':'no'`)));
    if (ready.includes('yes')) { console.log(`[t+${i*3}s] build gate ready`); break; }
    if (i % 4 === 0) console.log(`[t+${i*3}s] building...`);
  }
  console.log('Approve→', JSON.stringify(await clickModal('Approve Anyway'))); await sleep(2500);
  const modalGone = (await query(MODAL)).length === 0;
  console.log('modal closed (promoted)?', modalGone, ' alive?', await alive());
})().catch((e) => { console.error('AUTO-ADOPT ERROR:', e.message); process.exit(1); });
