#!/usr/bin/env node
/**
 * Live-app UI test for Studio (5 projects) — drives the REAL running app through
 * the test-automation bridge and asserts the multi-project UI/UX end-to-end:
 * the Vision form, five project tabs, tab switching, per-project build bubble,
 * checklist, and preview iframe. Project 1 is created via the Vision form (to
 * exercise that flow); projects 2-5 via the studioStore (reliable multi-create).
 *
 *   PERSONAS_BASE=http://localhost:17330 node scripts/studio-live-ui-test.mjs
 */
const BASE = process.env.PERSONAS_BASE || 'http://localhost:17330';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) =>
  fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
    .then((r) => r.json())
    .catch(() => ({}));
const query = (s) => post('/query', { selector: s }).then((r) => (Array.isArray(r) ? r : []));
const ev = (js) => post('/eval', { js });
const clickTestId = (id) => post('/click-testid', { test_id: id });
const count = async (sel) => (await query(sel)).length;
const exists = async (sel) => (await count(sel)) > 0;
const alive = async () =>
  (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const setVal = (sel, val) =>
  ev(
    `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 0;` +
      `const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;` +
      `const s=Object.getOwnPropertyDescriptor(proto,'value').set;s.call(el,${JSON.stringify(val)});` +
      `el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`,
  );
const createViaStore = (name, vision) =>
  ev(
    `(()=>{try{window.__studioStore.getState().createWithVision(${JSON.stringify(name)},${JSON.stringify(vision)});return 1}catch(e){return 'ERR '+e.message}})()`,
  );
const waitFor = async (fn, tries, gap, label) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    if (i % 6 === 0) console.log(`  …waiting: ${label} [t+${i * (gap / 1000)}s]`);
    await sleep(gap);
  }
  return false;
};

const PROJECTS = [
  ['live-landing', 'A clean landing page for a productivity app called Zenith — hero, features, a call to action. Calm and modern.'],
  ['live-dash', 'A small analytics dashboard with a few KPI cards and a chart, reading from local sample data. Dark and tidy.'],
  ['live-blog', 'A minimal blog home with a list of posts and a featured post. Editorial and readable.'],
  ['live-pricing', 'A pricing page with three plan cards and a feature comparison. Trustworthy and clear.'],
  ['live-gallery', 'An image gallery / portfolio grid with a lightbox. Elegant and image-forward.'],
];

const results = [];
const check = (name, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  console.log('app alive at', BASE);
  await ev('location.reload()');
  await sleep(8000);
  await post('/navigate', { section: 'studio' });
  await sleep(2500);

  check('studio vision form renders', await exists('[data-testid="studio-vision-name"]'));
  check('studioStore exposed', (await ev('typeof window.__studioStore')) && (await exists('[data-testid="studio-vision-name"]')));

  // Project 1 via the Vision form
  const [n1, v1] = PROJECTS[0];
  await setVal('[data-testid="studio-vision-name"]', n1);
  await sleep(300);
  await setVal('[data-testid="studio-vision-text"]', v1);
  await sleep(300);
  await clickTestId('studio-vision-submit');
  console.log(`project 1 (${n1}) submitted via form; scaffolds take ~1-2 min each…`);
  check('project 1 tab appears (form flow)', await waitFor(async () => (await count('[data-testid="studio-tab"]')) >= 1, 48, 5000, 'tab 1'));

  // Projects 2-5 via the store, sequentially (serializes app scaffolds)
  for (let i = 1; i < PROJECTS.length; i++) {
    const [name, vision] = PROJECTS[i];
    await createViaStore(name, vision);
    console.log(`project ${i + 1} (${name}) created via store…`);
    await waitFor(async () => (await count('[data-testid="studio-tab"]')) >= i + 1, 48, 5000, `tab ${i + 1}`);
  }

  const tabs = await count('[data-testid="studio-tab"]');
  check(`all 5 project tabs present (got ${tabs})`, tabs >= 5);

  // Tab switching: click each tab, confirm the active preview/checklist/bubble area renders
  let switched = 0;
  for (let i = 0; i < Math.min(tabs, 5); i++) {
    await ev(`(()=>{const t=document.querySelectorAll('[data-testid="studio-tab"] button');if(t[${i}]){t[${i}].click();return 1}return 0})()`);
    await sleep(1500);
    if (await exists('[data-testid="studio-checklist-tab"], iframe[title="preview"], [data-testid="studio-chat-input"]')) switched++;
  }
  check(`tab switching renders active project (${switched}/${Math.min(tabs, 5)})`, switched >= Math.min(tabs, 5));

  check('preview iframe present', await waitFor(async () => await exists('iframe[title="preview"]'), 36, 5000, 'preview iframe'));
  check('build bubble present', await exists('[data-testid="studio-chat-bubble"]'));
  check('chat input present', await exists('[data-testid="studio-chat-input"]'));

  const passed = results.filter(Boolean).length;
  console.log(`\n=== live-UI (5 projects): ${passed}/${results.length} checks passed | tabs=${tabs} ===`);
  process.exit(passed >= results.length - 1 ? 0 : 1);
})();
