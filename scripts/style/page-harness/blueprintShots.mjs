#!/usr/bin/env node
// Integrated-page shots of the blueprint drawing set on its Kettle fixture, one frame per level and state, in both
// themes and two sizes, plus the type measurement (smallest type, share of text under 14 px; DOM and canvas) and the
// title-block check (WP4b): the identity line and the crumbs neither clipped nor under the lens sheets, and the
// sheets inside the title block, in every frame. A failed check is a problem, like a console error.
//
//   node scripts/style/page-harness/blueprintShots.mjs --port 1477 --out src/features/decision-center/blueprint/shots
//        [--sizes 1280x800,1920x1080] [--themes dark-midnight,light] [--only L0,L4] [--measure-only]
//
// A Vite server of its own on --port (never 1420/1430/1440), closed on exit. Reduced motion is emulated so the camera
// lands where it flies; the page clock is fixed at the fixture's own "now". Exit 1 on a console error.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarnessServer, launchHarnessBrowser, HARNESS } from './harnessRun.mjs';
import { buildSyntheticTape } from './synthetic-tapes.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const PORT = Number(args.port ?? 1477);
if ([1420, 1430, 1440].includes(PORT)) throw new Error('port ' + PORT + ' belongs to another session');
const OUT = resolve(args.out ?? join(REPO, 'src/features/decision-center/blueprint/shots'));
const SIZES = String(args.sizes ?? '1280x800,1920x1080').split(',').map((s) => s.split('x').map(Number));
const THEMES = String(args.themes ?? 'dark-midnight,light').split(',');
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const NOW = '2026-10-15T12:00:00.000Z';
mkdirSync(OUT, { recursive: true });

/** Records every canvas text draw of the LAST frame (a frame starts at its full-canvas paper fill). */
const CANVAS_PROBE = () => {
  const ctxProto = CanvasRenderingContext2D.prototype;
  const rec = { frame: [] };
  window.__CANVAS_TEXT__ = rec;
  const fillRect = ctxProto.fillRect;
  ctxProto.fillRect = function (x, y, w, h) {
    const c = this.canvas;
    if (x === 0 && y === 0 && c && c.clientWidth && Math.abs(w - c.clientWidth) < 1 && Math.abs(h - c.clientHeight) < 1) rec.frame = [];
    return fillRect.call(this, x, y, w, h);
  };
  for (const fn of ['fillText', 'strokeText']) {
    const orig = ctxProto[fn];
    ctxProto[fn] = function (text, ...rest) {
      if (fn === 'fillText') { const m = /(\d+(?:\.\d+)?)px/.exec(this.font); rec.frame.push({ px: m ? Number(m[1]) : 0, n: String(text).replace(/\s/g, '').length }); }
      return orig.call(this, text, ...rest);
    };
  }
};

/** Characters of rendered DOM text by computed font size, over what is actually visible. */
const MEASURE_DOM = () => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s/g, '');
    const el = n.parentElement;
    if (!t || !el || el.closest('script,style,.sr-only,[aria-hidden="true"] canvas,[data-harness]')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (!el.closest('[data-testid="blueprint-sheet"],[role="dialog"]')) continue;
    out.push({ px: parseFloat(cs.fontSize), n: t.length, text: n.textContent.trim().slice(0, 40) });
  }
  return out;
};

/** One key, then a beat: the sheet draws a frame between presses, as a person's fingers would let it. */
const k = async (p, key) => { await p.keyboard.press(key); await p.waitForTimeout(280); };

const LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);

const STATES = {
  L0: async (p) => { await k(p, '0'); },
  L1: async (p) => { await k(p, '0'); await k(p, 'l'); },
  L2: async (p) => { await k(p, '0'); await k(p, 'l'); await k(p, 'Enter'); },
  L3: async (p) => { await k(p, '0'); await k(p, 'l'); await k(p, 'Enter'); await k(p, 'Enter'); },
  L4: async (p) => { await k(p, '0'); await k(p, 'j'); await k(p, 'Enter'); await k(p, 'Enter'); await k(p, 'Enter'); },
  'state-approved': async (p) => { await k(p, 'j'); await k(p, 'a'); },
  'state-decline-prompt': async (p) => { await k(p, 'j'); await k(p, 'x'); await p.keyboard.type('Superseded by the redesign'); },
  'state-build-armed': async (p) => { await k(p, 'j'); await k(p, 'a'); await k(p, 'j'); await k(p, 'a'); await k(p, 'b'); },
  'state-build-started': async (p) => { await k(p, 'j'); await k(p, 'a'); await k(p, 'b'); await k(p, 'b'); },
  'state-find': async (p) => { await k(p, '/'); await p.keyboard.type('book'); },
  'state-keys': async (p) => { await k(p, '?'); },
  // bp-fidelity Stage A: the header's project switcher, open on the fixture's synthetic product list
  'state-switcher': async (p) => { await p.click('[data-testid="blueprint-project-switcher"] .projsw-btn'); await p.waitForTimeout(300); },
  'state-lens-performance': async (p) => { await k(p, '0'); await k(p, '8'); },
  'state-lens-custom': async (p) => { await k(p, '0'); await k(p, '9'); },
  // WP4b: the compare panel on a done item (opens with the feature), on a performance item, the rework note prompt,
  // a reopen the store refuses (no prior status) and a descope it refuses (the release has left draft)
  'state-compare': async () => {},
  'state-compare-perf': async () => {},
  'state-rework-prompt': async (p) => { await k(p, 'r'); await p.keyboard.type('Shoot the designed state, not the default'); },
  'state-reopen-refused': async (p) => { await k(p, 'u'); },
  'state-in-release': async (p) => { await k(p, 's'); await p.keyboard.type('Not worth the risk now'); await k(p, 'Enter'); },
};

/** The feature a state opens on (`?feature=`), its L4 sheet open at once. */
const FEATURE = {
  'state-compare': 'book-a-class', 'state-compare-perf': 'drag-and-drop-timetable-editor', 'state-rework-prompt': 'book-a-class',
  'state-reopen-refused': 'studio-kpi-dashboard', 'state-in-release': 'revenue-reports',
};
/** Frames taken at every size: the levels and the compare panel. */
const EVERY_SIZE = new Set([...LEVELS, 'state-compare']);

/** The title block, measured: what is clipped, what the lens sheets cover, whether the sheets leave the block. */
const TITLE_CHECK = () => {
  const hd = document.querySelector('.bp-hd');
  if (!hd) return ['no title block'];
  const out = [], tabs = hd.querySelector('.bp-sheets-col')?.getBoundingClientRect(), box = hd.getBoundingClientRect();
  for (const sel of ['.bp-l1', '.bp-l2']) {
    const el = hd.querySelector(sel);
    if (!el) { out.push(sel + ' missing'); continue; }
    if (el.scrollWidth > el.clientWidth + 1) out.push(`${sel} clipped: ${el.scrollWidth} > ${el.clientWidth}`);
    const r = el.getBoundingClientRect();
    if (tabs && r.right > tabs.left && r.left < tabs.right && r.bottom > tabs.top && r.top < tabs.bottom) out.push(sel + ' under the lens sheets');
  }
  if (tabs && (tabs.bottom > box.bottom + 1 || tabs.right > box.right + 1)) out.push('the lens sheets leave the title block');
  return out;
};

const server = await startHarnessServer({ port: PORT });
const browser = await launchHarnessBrowser();
const report = { sizes: {}, problems: [] };
try {
  const tape = buildSyntheticTape('decision-center/blueprint', REPO);
  for (const theme of THEMES) for (const [w, h] of SIZES) {
    for (const [name, run] of Object.entries(STATES)) {
      if (ONLY && !ONLY.has(name)) continue;
      // the five levels and the compare panel at every size; the other states at the first size only
      if (!EVERY_SIZE.has(name) && (w !== SIZES[0][0] || h !== SIZES[0][1])) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 800)); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + String(e?.message ?? e).slice(0, 800)));
      await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((t) => { window.__PAGE_HARNESS_TAPE__ = t; }, tape);
      await page.addInitScript(CANVAS_PROBE);
      const url = `${server.url}${HARNESS}?module=decision-center/blueprint&theme=${theme}${FEATURE[name] ? '&feature=' + FEATURE[name] : ''}`;
      await page.goto(url, { waitUntil: 'commit' });
      await page.waitForFunction(() => { const s = window.__PAGE_HARNESS__; return !!s && (s.mounted || !!s.error); }, null, { timeout: 180_000 });
      await page.waitForSelector('[data-testid="blueprint-sheet"]', { timeout: 60_000 });
      await page.waitForTimeout(900);
      await page.locator('[data-testid="blueprint-sheet"]').focus().catch(() => {});
      await run(page);
      await page.waitForTimeout(700);
      const file = `${name}-${w}x${h}-${theme === 'light' ? 'light' : 'dark'}.png`;
      if (!args['measure-only']) await page.screenshot({ path: join(OUT, file), animations: 'disabled', caret: 'hide' });
      const dom = await page.evaluate(MEASURE_DOM);
      const canvas = await page.evaluate(() => window.__CANVAS_TEXT__.frame);
      const sum = (a, f) => a.filter(f).reduce((s, x) => s + x.n, 0);
      const key = `${name} ${w}x${h} ${theme}`;
      const title = await page.evaluate(TITLE_CHECK);
      if (title.length) errors.push('title block: ' + title.join('; '));
      report.sizes[key] = {
        domMin: Math.min(...dom.map((x) => x.px)), domChars: sum(dom, () => true), domUnder14: sum(dom, (x) => x.px < 14),
        canvasMin: canvas.length ? Math.min(...canvas.map((x) => x.px)) : null, canvasChars: sum(canvas, () => true), canvasUnder14: sum(canvas, (x) => x.px < 14),
        smallestDom: dom.filter((x) => x.px === Math.min(...dom.map((y) => y.px))).slice(0, 3).map((x) => x.text),
      };
      await ctx.close();
      // Windows can run out of socket buffers under many parallel module requests: a transport failure, not the page; retry that shot
      const transport = errors.length > 0 && errors.every((e) => /ERR_NO_BUFFER_SPACE|ERR_INSUFFICIENT_RESOURCES/.test(e));
      if (transport && attempt < 2) continue;
      if (errors.length) report.problems.push({ key, errors });
      process.stdout.write('.');
      break;
      }
    }
  }
} finally {
  await browser.close();
  await server.server.close();
}
writeFileSync(join(OUT, 'measure.json'), JSON.stringify(report, null, 1));
console.log('\n' + (report.problems.length ? 'PROBLEMS ' + JSON.stringify(report.problems, null, 1) : 'no console errors'));
process.exit(report.problems.length ? 1 : 0);
