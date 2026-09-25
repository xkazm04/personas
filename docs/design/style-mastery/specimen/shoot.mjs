#!/usr/bin/env node
// shoot.mjs - screenshots + console capture for the Gate 0 specimen, and the
// Chromium probe behind the migration map's dry-run counts.
//
// Needs the app's Vite on its own port (never the dev app's 1420):
//   npx vite --port 1431 --strictPort
// then, from the repo root:
//   node docs/design/style-mastery/specimen/shoot.mjs --out <dir>          shots + console report
//   node docs/design/style-mastery/specimen/shoot.mjs --probe              writes dryrun.generated.json
// Options: --base http://localhost:1431  --themes dark-midnight,light  --all-themes  --console-only
//
// Shots are named <section>-<theme>-<w>x<h>-<current|proposed>.png. They are
// machine-local review material: write them outside the repo.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:1431');
const PAGE = `${BASE}/docs/design/style-mastery/specimen/index.html`;
const ALL = ['dark-midnight', 'dark-cyan', 'dark-bronze', 'dark-frost', 'dark-purple', 'dark-pink', 'dark-red', 'dark-matrix', 'light', 'light-ice', 'light-news'];
const THEMES = process.argv.includes('--all-themes') ? ALL : arg('themes', 'dark-midnight,light').split(',');
const SIZES = [[1280, 800], [1920, 1080]];
const SECTIONS = ['type', 'muting', 'colour', 'compose', 'font'];
const VIEWS = ['current', 'proposed'];
const SCALES = ['larger', 'xl'];

/** Playwright's pinned headless shell may not be downloaded on this machine;
 *  fall back to the newest one in the shared cache (or SPECIMEN_CHROMIUM). */
async function launch() {
  try { return await chromium.launch(); } catch (e) {
    const cache = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
    const exe = process.env.SPECIMEN_CHROMIUM ||
      (shells.length ? join(cache, shells[shells.length - 1], 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : null);
    if (!exe) throw e;
    console.log(`pinned browser missing; using ${exe}`);
    return chromium.launch({ executablePath: exe });
  }
}

async function open(browser, size) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { ctx, page, errors };
}

async function load(page, q) {
  await page.goto(`${PAGE}?${new URLSearchParams(q)}`, { waitUntil: 'networkidle' });
  await page.waitForFunction((want) => document.documentElement.dataset.specimenReady === want, `${q.theme}|${q.scale}|${q.view}`);
  await page.waitForTimeout(700); // cross-fade (250 ms), font-size transition (150 ms), spec read (400 ms)
}

async function shots(outDir) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const report = { page: PAGE, runs: [], totalErrors: 0 };
  // 1. Console capture: every theme asked for, both text scales, side-by-side view.
  for (const theme of THEMES) for (const scale of SCALES) {
    const { ctx, page, errors } = await open(browser, SIZES[0]);
    await load(page, { theme, scale, view: 'side' });
    const html = await page.evaluate(() => ({
      dataTheme: document.documentElement.getAttribute('data-theme'),
      dataTextScale: document.documentElement.getAttribute('data-text-scale'),
      proposalCols: document.querySelectorAll('[data-style-proposal]').length,
      specsRead: document.querySelectorAll('[data-spec]').length,
    }));
    report.runs.push({ theme, scale, errors, ...html });
    report.totalErrors += errors.length;
    await ctx.close();
  }
  // 2. Shots: per section, per view, per size, at the default text scale.
  let n = 0;
  if (!process.argv.includes('--console-only')) for (const size of SIZES) for (const theme of THEMES) for (const section of SECTIONS) for (const view of VIEWS) {
    const { ctx, page, errors } = await open(browser, size);
    await load(page, { theme, scale: 'larger', view, section });
    const file = join(outDir, `${section}-${theme}-${size[0]}x${size[1]}-${view}.png`);
    await page.screenshot({ path: file, fullPage: true });
    report.totalErrors += errors.length;
    if (errors.length) report.runs.push({ theme, section, view, size, errors });
    n++;
    await ctx.close();
  }
  await browser.close();
  report.shots = n;
  writeFileSync(join(outDir, 'console-report.json'), JSON.stringify(report, null, 1));
  console.log(`shots ${n}; console errors ${report.totalErrors}; report ${join(outDir, 'console-report.json')}`);
  for (const r of report.runs.slice(0, THEMES.length * SCALES.length)) {
    console.log(`  ${r.theme} ${r.scale}: errors ${r.errors.length}, data-theme=${r.dataTheme ?? '(none, the default)'}, data-text-scale=${r.dataTextScale}, proposal columns ${r.proposalCols}, specs read ${r.specsRead}`);
  }
  if (report.totalErrors) process.exitCode = 1;
}

async function probe() {
  const browser = await launch();
  const { ctx, page, errors } = await open(browser, [1280, 800]);
  await page.goto(`${BASE}/docs/design/style-mastery/specimen/probe.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__probe && window.__probe.done, null, { timeout: 120000 });
  const result = await page.evaluate(() => window.__probe);
  await ctx.close();
  await browser.close();
  result.consoleErrors = errors;
  const { pairs, ...head } = result;
  writeFileSync(join(HERE, 'dryrun.generated.json'),
    JSON.stringify(head).replace(/}$/, ',"pairs":[\n') + pairs.map((p) => JSON.stringify(p)).join(',\n') + '\n]}\n');
  console.log(`probe: ${result.pairs.length} pairs classified; console errors ${errors.length}`);
}

if (process.argv.includes('--probe')) await probe();
else await shots(arg('out', join(process.cwd(), 'shots')));
