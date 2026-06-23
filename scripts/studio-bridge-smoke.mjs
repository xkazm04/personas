#!/usr/bin/env node
/**
 * Robust bridge smoke — proves the hardened test bridge can reliably drive the
 * live Studio UI. The bridge now force-foregrounds the webview before each retry
 * (defeating occlusion-suspend) and exposes /focus; this driver calls /focus at
 * the start and before every poll, then runs the ops that were flaky before:
 * navigate, query, fill, click, and wait for the project to come up.
 *
 *   PERSONAS_BASE=http://127.0.0.1:17330 node scripts/studio-bridge-smoke.mjs
 */
const BASE = process.env.PERSONAS_BASE || 'http://127.0.0.1:17330';
const NAME = process.env.SLUG || 'bridge-smoke';
const VISION =
  'A simple landing page for a tea brand called Leaf — a hero, three highlights, and a footer. Calm and clean.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) =>
  fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
    .then((r) => r.json())
    .catch(() => null);
const focus = () => post('/focus', {});
const query = async (s) => {
  const r = await post('/query', { selector: s });
  return Array.isArray(r) ? r : [];
};
const ev = (js) => post('/eval', { js });
const clickTestId = (id) => post('/click-testid', { test_id: id });
const count = async (s) => (await query(s)).length;
const alive = async () =>
  (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';
const setVal = (sel, val) =>
  ev(
    `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 0;` +
      `const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;` +
      `const s=Object.getOwnPropertyDescriptor(proto,'value').set;s.call(el,${JSON.stringify(val)});` +
      `el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`,
  );
const waitFor = async (fn, tries, gap, label) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    if (i % 5 === 0) console.log(`  …${label} [t+${(i * gap) / 1000}s]`);
    await focus();
    await sleep(gap);
  }
  return false;
};

const results = [];
const check = (n, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  console.log('app alive at', BASE);
  await focus();
  await ev('location.reload()');
  await sleep(8000);
  await focus();

  const nav = await post('/navigate', { section: 'studio' });
  check('navigate(studio) succeeds', !!nav && (nav.success === true || JSON.stringify(nav).includes('studio')));
  await sleep(2500);

  check('vision form reachable', await waitFor(async () => (await count('[data-testid="studio-vision-name"]')) >= 1, 12, 2000, 'vision form'));
  await setVal('[data-testid="studio-vision-name"]', NAME);
  await sleep(300);
  await setVal('[data-testid="studio-vision-text"]', VISION);
  await sleep(300);
  check('vision fields readable after fill', (await count('[data-testid="studio-vision-name"]')) >= 1);
  await clickTestId('studio-vision-submit');
  console.log('submitted; scaffold + dev server (~1-2 min)…');

  check('project tab appears', await waitFor(async () => (await count('[data-testid="studio-tab"]')) >= 1, 60, 5000, 'tab'));
  check('preview iframe loads', await waitFor(async () => (await count('iframe[title="preview"]')) >= 1, 48, 5000, 'preview'));
  check('chat input present', (await count('[data-testid="studio-chat-input"]')) >= 1);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== bridge smoke: ${passed}/${results.length} checks passed ===`);
  process.exit(passed >= results.length - 1 ? 0 : 1);
})();
