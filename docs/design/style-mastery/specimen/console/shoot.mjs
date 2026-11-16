#!/usr/bin/env node
// Shoots the Console specimen (dark + light, 1920x1080) and prints computed fonts.
//   npx vite --port 5251 --strictPort   (separate terminal), then
//   node docs/design/style-mastery/specimen/console/shoot.mjs --out <dir>
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5251');
const OUT = arg('out', 'tmp/console-style/specimen');
const THEMES = arg('themes', 'dark-midnight,light').split(',');
mkdirSync(OUT, { recursive: true });

async function launch() {
  try { return await chromium.launch(); } catch (e) {
    const cache = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
    if (!shells.length) throw e;
    return chromium.launch({ executablePath: join(cache, shells[shells.length - 1], 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') });
  }
}
const browser = await launch();
for (const theme of THEMES) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/docs/design/style-mastery/specimen/console/index.html?theme=${theme}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction((t) => document.documentElement.dataset.specimenReady === t, theme, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const probe = await page.evaluate(() => {
    const ff = (sel) => getComputedStyle(document.querySelector(sel)).fontFamily;
    const root = getComputedStyle(document.documentElement);
    return {
      body: getComputedStyle(document.body).fontFamily, bodyRecipe: ff('.typo-body'), data: ff('.typo-data'), num: ff('.num'),
      roles: ['--ink-1', '--ink-2', '--ink-3', '--ink-4', '--hair', '--surface-1', '--sel', '--acc-wash'].map((v) => `${v}=${root.getPropertyValue(v).trim()}`),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i),
    };
  });
  console.log(theme, JSON.stringify(probe, null, 1), 'errors:', errors);
  await page.screenshot({ path: join(OUT, `console-${theme}-1920x1080.png`), fullPage: true });
}
await browser.close();
