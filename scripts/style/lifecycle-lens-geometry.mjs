#!/usr/bin/env node
// The Lens's fixed header, measured (owner, 2026-10-16: "header section with fixed height").
// Drives the real Lifecycle page in the page harness through every plane - the portfolio, a
// pointer resting on a cell, one step across every project, a project, a step's detail - and
// asserts the header's height and the top of the plane under it never move, at each size.
// Also asserts the detail is its own layer: no column is in the document while it shows.
//
//   node scripts/style/lifecycle-lens-geometry.mjs                      # the synthetic portfolio tape
//   node scripts/style/lifecycle-lens-geometry.mjs --tape <tape.json>   # a recorded tape (never commit one)
//   options: --sizes 1280x800,1920x1080  --theme dark-midnight  --port 4394
//
// Exit 1 on any move, a missing plane, or a console error.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HARNESS, launchHarnessBrowser, startHarnessServer } from './page-harness/harnessRun.mjs';
import { buildSyntheticTape } from './page-harness/synthetic-tapes.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const MODULE = 'plugins/lifecycle/portfolio';
const PORT = Number(arg('port', 4394));
const SIZES = String(arg('sizes', '1280x800,1920x1080')).split(',').map((s) => s.split('x').map(Number));
const THEME = arg('theme', 'dark-midnight');
const TAPE_FILE = arg('tape', null);

const tape = TAPE_FILE ? JSON.parse(readFileSync(TAPE_FILE, 'utf8')) : buildSyntheticTape(MODULE, REPO);

/** The header box and the top of whatever the plane shows first. */
const measure = () => {
  const head = document.querySelector('[data-testid="lens-head"]')?.getBoundingClientRect();
  const plane = document.querySelector('.lens-planes')?.getBoundingClientRect();
  return {
    head: head ? Math.round(head.height * 10) / 10 : null,
    headTop: head ? Math.round(head.top * 10) / 10 : null,
    planeTop: plane ? Math.round(plane.top * 10) / 10 : null,
    plane: document.querySelector('[data-testid="lc-journey"]')?.getAttribute('data-plane') ?? null,
    columns: document.querySelectorAll('[data-testid="lens-field"] [role="option"]').length,
  };
};

async function run(page, url, [w, h]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${url}${HARNESS}?module=${encodeURIComponent(MODULE)}&theme=${THEME}&motion=reduce`, { waitUntil: 'commit' });
  await page.waitForSelector('[data-testid="lens-field"] [role="option"]', { timeout: 180_000 });
  await page.waitForTimeout(1200);
  const lit = await page.$eval('[data-testid="lens-field"] [aria-selected="true"]', (el) => el.getAttribute('data-testid'));
  const steps = [];
  const at = async (name, act, wait = 900) => {
    if (act) await act();
    await page.waitForTimeout(wait);
    steps.push({ name, ...(await page.evaluate(measure)) });
  };
  await at('portfolio', null, 0);
  await at('pointer on a cell', () => page.hover(`[data-testid="${lit}"] .lens-cell:not(.is-none)`));
  await at('step across every project', () => page.click(`[data-testid="${lit}"] .lens-col-head`));
  await at('back to the portfolio', () => page.keyboard.press('Escape'));
  await at('a project', () => page.click(`[data-testid="${lit}"] .lens-cell:not(.is-none)`), 1500);
  await at('a step detail', () => page.click('[data-testid="lens-field"] [aria-selected="true"] .lens-col-head'), 1500);
  await at('back to the project', () => page.keyboard.press('Escape'));
  return steps;
}

const { server, url } = await startHarnessServer({ port: PORT });
const browser = await launchHarnessBrowser();
let failed = false;
try {
  for (const size of SIZES) {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((t) => { window.__PAGE_HARNESS_TAPE__ = t; }, tape);
    const steps = await run(page, url, size);
    const [first] = steps;
    console.log(`\n${size.join('x')}  header ${first.head}px at y=${first.headTop}, plane at y=${first.planeTop}`);
    for (const s of steps) {
      const moved = s.head !== first.head || s.headTop !== first.headTop || s.planeTop !== first.planeTop;
      const detailWithColumns = s.name === 'a step detail' && (s.plane !== 'detail' || s.columns > 0);
      if (moved || detailWithColumns || s.head === null) failed = true;
      console.log(`  ${moved || detailWithColumns ? 'FAIL' : 'ok  '} ${s.name.padEnd(28)} plane=${String(s.plane).padEnd(10)} head=${s.head} planeTop=${s.planeTop} columns=${s.columns}`);
    }
    if (errors.length) { failed = true; console.log(`  FAIL console errors:\n    ${errors.slice(0, 5).join('\n    ')}`); }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
