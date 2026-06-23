#!/usr/bin/env node
/**
 * Live-app build of the mk showcase — drives the REAL Studio app through the
 * hardened bridge: registers the existing mk repo, opens it (dev server), seeds a
 * 5-page vision, runs autonomous, auto-answers decisions, and monitors the pages
 * appearing in mk on disk. The build's progress is read straight from the
 * filesystem (mk/app/**\/page.tsx) so it's independent of the bridge.
 *
 *   PERSONAS_BASE=http://127.0.0.1:17330 BUDGET_MIN=35 node scripts/studio-mk-live.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.PERSONAS_BASE || 'http://127.0.0.1:17330';
const MK = 'C:/Users/kazda/kiro/mk';
const BUDGET_MIN = Number(process.env.BUDGET_MIN || 35);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) =>
  fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
    .then((r) => r.json())
    .catch(() => null);
const focus = () => post('/focus', {});
const ev = (js) => post('/eval', { js });
const query = async (s) => { const r = await post('/query', { selector: s }); return Array.isArray(r) ? r : []; };
const count = async (s) => (await query(s)).length;
const clickTestId = (id) => post('/click-testid', { test_id: id });
const alive = async () => (await fetch(BASE + '/health').then((r) => r.json()).catch(() => null))?.status === 'ok';

function mkRoutes() {
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith('_') || e.name === 'node_modules') continue;
        walk(join(dir, e.name), rel + '/' + e.name);
      } else if (/^page\.(tsx?|jsx?)$/.test(e.name)) {
        out.push(rel === '' ? '/' : rel);
      }
    }
  };
  walk(join(MK, 'app'), '');
  return [...new Set(out)].sort();
}

// Newest mtime across the project's source — the real "is it still working?" signal.
// Counts ANY edit (a polishing pass on an existing page, a new component, etc.), so a
// busy build is never mistaken for a stall the way a page.tsx-count signal is.
function newestMtime() {
  let newest = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
        walk(p);
      } else if (/\.(tsx?|jsx?|css)$/.test(e.name)) {
        try { const m = statSync(p).mtimeMs; if (m > newest) newest = m; } catch { /* ignore */ }
      }
    }
  };
  for (const r of ['app', 'components', 'src', 'lib']) walk(join(MK, r));
  return newest;
}

const VISION =
  'Turn this repo into a polished multi-page showcase with FIVE distinct pages plus shared header/footer navigation linking them: (1) home = a tech product landing for a developer tool; (2) /marketing = a friendly product marketing page; (3) /dashboard = a data dashboard reading local sample data with charts and KPIs; (4) /pipeline = an animated scroll-driven explainer of an automated LLM dev pipeline; (5) /mindmap = an interactive mindmap canvas (add/drag/connect nodes). Each page distinct and best-in-class. Build all five pages and the shared navigation.';
const NUDGE =
  'Continue building all five pages autonomously — decide any content, names, and styling yourself with sensible defaults. Only the five pages + shared nav matter; keep going until they are all built and polished.';

(async () => {
  if (!(await alive())) { console.log('app down at', BASE); process.exit(1); }
  console.log('app alive. mk routes at start:', mkRoutes().join(' ') || '(blank)');
  await focus();
  await ev('location.reload()'); await sleep(8000); await focus();
  await post('/navigate', { section: 'studio' }); await sleep(2500); await focus();

  console.log('registering + opening mk in the app…');
  await ev(
    `window.__TAURI__.core.invoke('webbuild_register_existing',{name:'mk',path:'${MK}'})` +
      `.then(p=>{window.__mkId=p.id;return window.__studioStore.getState().startExisting(p.id,'mk');})` +
      `.catch(e=>{window.__mkErr=String(e&&e.message||e)})`,
  );

  let live = false;
  for (let i = 0; i < 72 && !live; i++) {
    await sleep(5000); await focus();
    live = (await count('[data-testid="studio-tab"]')) >= 1 && (await count('[data-testid="studio-chat-input"]')) >= 1;
    if (i % 4 === 0) console.log(`  …mk dev server starting [t+${i * 5}s] live=${live}`);
  }
  if (!live) { console.log('mk did not go live (dev server). aborting.'); process.exit(1); }
  console.log('mk is LIVE in the app. Seeding the 5-page vision + autonomous…');

  await ev(`window.__studioStore.getState().sendTurn(window.__mkId, ${JSON.stringify(VISION)})`);
  await sleep(1500);
  await ev(`window.__studioStore.getState().startAutonomous(window.__mkId)`);

  const t0 = Date.now();
  let lastProgress = t0, lastSig = '', answered = 0, lastNudge = 0, lastMtime = newestMtime();
  while ((Date.now() - t0) / 60000 < BUDGET_MIN) {
    await focus();
    if ((await count('[data-testid="studio-decision-option"]')) > 0) {
      await clickTestId('studio-decision-option');
      answered++;
      console.log(`  [decision] answered #${answered} (clicked first option) [t+${Math.round((Date.now() - t0) / 1000)}s]`);
      lastProgress = Date.now();
      await sleep(4000);
      continue;
    }
    const r = mkRoutes();
    const sig = r.join(' ');
    if (sig !== lastSig) {
      console.log(`  [t+${Math.round((Date.now() - t0) / 1000)}s] mk routes (${r.length}): ${sig || '(blank)'}`);
      lastSig = sig;
    }
    // mtime-based progress: any source edit (incl. polishing existing pages) resets the
    // stall clock, so a busy build is never mistaken for a stall.
    const mt = newestMtime();
    if (mt > lastMtime + 500) {
      lastMtime = mt;
      lastProgress = Date.now();
    }
    // Stall-breaker: only when NOTHING changed on disk for 3 min (genuinely stuck).
    if (Date.now() - lastProgress > 180000 && Date.now() - lastNudge > 120000) {
      await ev(`window.__studioStore.getState().sendTurn(window.__mkId, ${JSON.stringify(NUDGE)})`);
      lastNudge = Date.now();
      console.log(`  [nudge] stall-breaker sent [t+${Math.round((Date.now() - t0) / 1000)}s]`);
    }
    if (r.length >= 5 && ['/marketing', '/dashboard', '/pipeline', '/mindmap'].every((x) => r.includes(x))) {
      console.log(`  ✓ all 5 target routes present at t+${Math.round((Date.now() - t0) / 1000)}s — continuing to polish…`);
    }
    await sleep(15000);
  }

  console.log('\n=== budget reached. Final mk routes ===');
  console.log(mkRoutes().join('\n') || '(none)');
  console.log(`decisions answered: ${answered}`);
  process.exit(0);
})();
