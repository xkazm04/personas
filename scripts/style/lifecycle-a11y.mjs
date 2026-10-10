#!/usr/bin/env node
// Lifecycle keyboard probe (Lifecycle excellence wave 10): walks every tab stop
// of the page in a real Chromium through the page harness, per surface and
// theme, and fails on what a keyboard or screen-reader user would hit:
//
//   - a tab stop with no accessible name (aria-label, aria-labelledby, or text);
//   - a tab stop whose focus draws NOTHING (no outline, ring or box-shadow on the
//     element, its ::after or the kit row / card that draws its press's ring,
//     compared with the same element unfocused);
//   - a trap: Tab never leaves the page body within the step budget;
//   - focus that lands on an element hidden from view (zero size);
//   - text under WCAG AA against what is actually behind it: every visible text
//     run in the page body, its colour (with opacity) over its ancestors'
//     backgrounds composited down to the page's, through the app's brightness
//     filter (4.5:1, 3:1 for large text).
//     Text over a hatch or gradient is skipped (no single background to judge).
//
// The repo has no axe / a11y runner (searched package.json and scripts/,
// 2026-10-09); this is the module's own check. Surfaces: the collar (Layer 1),
// the Gate step screen, the first-run setup. Themes: dark-midnight, dark-frost
// (a near-white accent), light and light-news (a near-black accent).
//
// Usage: node scripts/style/lifecycle-a11y.mjs [--port 4393] [--themes a,b | all] [--out <file.json>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS, launchHarnessBrowser, startHarnessServer } from './page-harness/harnessRun.mjs';
import { buildSyntheticTape } from './page-harness/synthetic-tapes.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', 4393));
const ALL_THEMES = 'dark-midnight,dark-cyan,dark-bronze,dark-frost,dark-purple,dark-pink,dark-red,dark-matrix,light,light-ice,light-news';
const THEMES = String(arg('themes', 'dark-midnight,dark-frost,light,light-news')).replace(/^all$/, ALL_THEMES).split(',');
const OUT = arg('out', null);
const MAX_STOPS = 140;

const SURFACES = [
  { name: 'collar', module: 'plugins/lifecycle/collar', open: null, ready: '[data-testid="lc1-layer1"]' },
  { name: 'gate', module: 'plugins/lifecycle/gate', open: '[data-testid="lc-node-gate"]', ready: '[data-testid^="lc2-cmd-"]' },
  { name: 'setup', module: 'plugins/lifecycle/setup', open: null, ready: '[data-testid^="lc10-setup-row-"]' },
];

/** What the focused element is and whether its focus draws anything. Runs in the page. */
function inspectFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const main = document.getElementById('main-content');
  const label = el.getAttribute('aria-label')
    || (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
    || (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    || el.getAttribute('title') || el.getAttribute('placeholder') || '';
  const paint = (node, pseudo) => {
    const cs = getComputedStyle(node, pseudo);
    return [cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `outline:${cs.outlineWidth} ${cs.outlineColor}` : '', cs.boxShadow !== 'none' ? `shadow:${cs.boxShadow}` : '']
      .filter(Boolean).join(' ');
  };
  // A kit row / card draws its press's ring on itself (`:has(:focus-visible)`), so it is read too.
  const host = el.closest('.k-row, .k-card, .k-dtile');
  const focused = paint(el) + '|' + paint(el, '::after') + '|' + (host ? paint(host) : '');
  const r = el.getBoundingClientRect();
  return {
    inPage: !!main?.contains(el),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? '',
    testId: el.getAttribute('data-testid') ?? el.closest('[data-testid]')?.getAttribute('data-testid') ?? '',
    label: label.slice(0, 80),
    focused,
    size: [Math.round(r.width), Math.round(r.height)],
  };
}

/** Text runs under AA in the page body. Runs in the page. */
function scanContrast() {
  // Any CSS colour (oklch, color(srgb ...), rgb) to sRGB bytes + alpha, through a 1px canvas:
  // Tailwind 4 and color-mix() hand back colours a regex cannot read.
  const ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const memo = new Map();
  const parse = (c) => {
    if (!c || c === 'transparent') return null;
    if (memo.has(c)) return memo.get(c);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const v = a === 0 ? null : { r, g, b, a: a / 255 };
    memo.set(c, v);
    return v;
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 1 };
  // The app's brightness filter on <html> (1.25 on a dark theme, 0.82 on a light one by default)
  // scales every channel the eye sees, so the judged colours are the filtered ones.
  const k = Number(getComputedStyle(document.documentElement).getPropertyValue('--app-brightness')) || 1;
  const lit = (c) => ({ r: Math.min(255, c.r * k), g: Math.min(255, c.g * k), b: Math.min(255, c.b * k), a: 1 });
  const root = document.querySelector('[data-testid="lc-journey"]');
  if (!root) return [];
  const out = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = t.parentElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.closest('[aria-hidden="true"], .sr-only, [data-ghost]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    let fg = parse(cs.color);
    let opacity = 1;
    const layers = [];
    let skip = false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const ns = getComputedStyle(n);
      opacity *= Number(ns.opacity);
      if (ns.backgroundImage !== 'none' && !ns.backgroundImage.startsWith('url(')) skip = true;
      const bg = parse(ns.backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
    }
    if (skip || !fg) continue;
    let bg = pageBg;
    for (const l of layers.reverse()) bg = over(l, bg);
    fg = over({ ...fg, a: fg.a * opacity }, bg);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(lit(fg), lit(bg));
    if (got < need) {
      const key = `${el.className}`.slice(0, 120) + '|' + text.slice(0, 40);
      // The shared solid CTA (bg-btn-primary): white on the accent, which the dark themes' brightness
      // filter lifts under AA app-wide (globals.css compensates gradients, not this). Not the module's.
      const appLevel = !!el.closest('[class*="bg-btn-primary"]');
      if (!out.has(key)) out.set(key, { text: text.slice(0, 60), ratio: Number(got.toFixed(2)), need, appLevel, cls: String(el.className).slice(0, 140), testId: el.closest('[data-testid]')?.getAttribute('data-testid') ?? '' });
    }
  }
  return [...out.values()];
}

async function walk(browser, url, surface, theme) {
  const tape = buildSyntheticTape(surface.module, REPO);
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  await page.addInitScript((t) => { window.__PAGE_HARNESS_TAPE__ = t; }, tape);
  await page.goto(`${url}${HARNESS}?module=${encodeURIComponent(surface.module)}&theme=${theme}`, { waitUntil: 'commit' });
  await page.waitForSelector(surface.open ?? surface.ready, { timeout: 180_000 });
  if (surface.open) {
    await page.waitForTimeout(800);
    await page.click(surface.open);
    await page.waitForSelector(surface.ready, { timeout: 30_000 });
  }
  await page.waitForTimeout(1200);
  const lowContrast = await page.evaluate(scanContrast);
  // Start from the page's own top: focus the first element of the main region's flow.
  await page.evaluate(() => { (document.activeElement)?.blur?.(); document.getElementById('main-content')?.focus?.(); });
  const stops = [];
  const problems = [];
  let left = false;
  for (let i = 0; i < MAX_STOPS; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(inspectFocus);
    if (!f) continue;
    if (!f.inPage) { if (stops.length > 0) { left = true; break; } continue; }
    // The same element unfocused, for the "does focus draw anything" comparison.
    const rest = await page.evaluate(() => {
      const el = document.activeElement;
      const paint = (node, pseudo) => { const cs = getComputedStyle(node, pseudo); return [cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `outline:${cs.outlineWidth} ${cs.outlineColor}` : '', cs.boxShadow !== 'none' ? `shadow:${cs.boxShadow}` : ''].filter(Boolean).join(' '); };
      const host = el.closest('.k-row, .k-card, .k-dtile');
      el.blur();
      const s = paint(el) + '|' + paint(el, '::after') + '|' + (host ? paint(host) : '');
      el.focus({ preventScroll: true });
      return s;
    });
    const key = `${f.testId}|${f.label}`;
    if (stops.some((s) => s.key === key) && stops.length > 3 && stops[0].key === key) { left = true; break; }
    stops.push({ key, ...f });
    if (!f.label) problems.push(`no accessible name: ${f.tag}[role=${f.role}] ${f.testId}`);
    if (f.focused === rest && !/\boption\b/.test(f.role)) problems.push(`focus draws nothing: ${f.tag} ${f.testId} "${f.label}"`);
    if (f.size[0] === 0 || f.size[1] === 0) problems.push(`focus on a zero-size element: ${f.tag} ${f.testId}`);
  }
  if (!left) problems.push(`no way out: Tab stayed inside the page for ${MAX_STOPS} stops`);
  await context.close();
  for (const c of lowContrast.filter((x) => !x.appLevel)) problems.push(`contrast ${c.ratio} < ${c.need}: "${c.text}" (${c.testId}) ${c.cls}`);
  const appLevel = lowContrast.filter((x) => x.appLevel).map((c) => `contrast ${c.ratio} < ${c.need}: "${c.text}" (${c.testId}, the shared primary button)`);
  return { surface: surface.name, theme, stops: stops.map(({ key, ...s }) => s), problems, appLevel };
}

async function main() {
  const browser = await launchHarnessBrowser();
  const { server, url } = await startHarnessServer({ port: PORT });
  const results = [];
  try {
    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const r = await walk(browser, url, surface, theme);
        results.push(r);
        console.log(`${r.problems.length ? 'FAIL' : 'ok  '} ${surface.name} ${theme}: ${r.stops.length} tab stops${r.problems.length ? `\n  ${r.problems.join('\n  ')}` : ''}${r.appLevel.length ? `\n  (app-level, not failed here) ${r.appLevel.join('; ')}` : ''}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log('\nTab order (dark-midnight):');
  for (const r of results.filter((x) => x.theme === THEMES[0])) {
    console.log(`  ${r.surface}: ${r.stops.map((s) => s.label || s.testId).join(' > ')}`);
  }
  if (OUT) {
    mkdirSync(dirname(resolve(OUT)), { recursive: true });
    writeFileSync(resolve(OUT), JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
  }
  process.exitCode = results.some((r) => r.problems.length) ? 1 : 0;
}

main().catch((err) => { console.error(err?.stack ?? String(err)); process.exitCode = 1; });
