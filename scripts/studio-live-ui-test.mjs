#!/usr/bin/env node
/**
 * Live-app UI test for Studio — drives the REAL running app through the
 * test-automation bridge (the reliable /query + /click-testid + sync /eval
 * patterns the existing playwright drivers use) and asserts the UI/UX
 * end-to-end: the Vision form works, a project tab appears, the build feedback
 * bubble shows, the checklist drawer is present, and the preview iframe loads.
 *
 * This complements the headless harness (which only proves code-gen): here the
 * actual tabs / bubble / checklist / preview UI is exercised.
 *
 *   PERSONAS_BASE=http://localhost:17330 node scripts/studio-live-ui-test.mjs
 */
const BASE = process.env.PERSONAS_BASE || 'http://localhost:17330';
const NAME = process.env.SLUG || 'live-ui-probe';
const VISION =
  process.env.VISION ||
  'A simple landing page for a coffee shop called Brew — a hero, a few highlights, and opening hours. Warm and clean.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b || {}),
  })
    .then((r) => r.json())
    .catch(() => ({}));
const query = (s) => post('/query', { selector: s }).then((r) => (Array.isArray(r) ? r : []));
const ev = (js) => post('/eval', { js });
const clickTestId = (id) => post('/click-testid', { test_id: id });
const exists = async (sel) => (await query(sel)).length > 0;
const alive = async () =>
  (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
// Set a controlled React input/textarea value (native setter + input event).
const setVal = (sel, val) =>
  ev(
    `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 0;` +
      `const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;` +
      `const s=Object.getOwnPropertyDescriptor(proto,'value').set;s.call(el,${JSON.stringify(val)});` +
      `el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`,
  );
const waitFor = async (sel, tries, gap, label) => {
  for (let i = 0; i < tries; i++) {
    if (await exists(sel)) return true;
    if (i % 4 === 0) console.log(`  …waiting for ${label || sel} [t+${i * (gap / 1000)}s]`);
    await sleep(gap);
  }
  return false;
};

const results = [];
const check = (name, ok) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

(async () => {
  if (!(await alive())) {
    console.log('app down at', BASE);
    process.exit(1);
  }
  console.log('app alive at', BASE);
  await ev('location.reload()');
  await sleep(8000);
  await post('/navigate', { section: 'studio' });
  await sleep(2500);

  check('studio vision form renders', await exists('[data-testid="studio-vision-name"]'));

  await setVal('[data-testid="studio-vision-name"]', NAME);
  await sleep(300);
  await setVal('[data-testid="studio-vision-text"]', VISION);
  await sleep(300);
  await clickTestId('studio-vision-submit');
  console.log('submitted vision; scaffold + dev server + seed build can take a few minutes…');

  check('project tab appears', await waitFor('[data-testid="studio-tab"]', 72, 5000, 'project tab (scaffold)'));
  check('preview iframe loads', await waitFor('iframe[title="preview"]', 48, 5000, 'preview iframe (dev server)'));
  check('build bubble appears', await waitFor('[data-testid="studio-chat-bubble"]', 48, 5000, 'build bubble'));
  check('checklist tab present', await exists('[data-testid="studio-checklist-tab"]'));
  check('chat input present', await exists('[data-testid="studio-chat-input"]'));

  const passed = results.filter(Boolean).length;
  console.log(`\n=== live-UI: ${passed}/${results.length} checks passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})();
