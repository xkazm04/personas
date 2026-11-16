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
  L1: async (p) => { await k(p, '0'); await k(p, 'ArrowRight'); },
  L2: async (p) => { await k(p, '0'); await k(p, 'ArrowRight'); await k(p, 'Enter'); },
  L3: async (p) => { await k(p, '0'); await k(p, 'ArrowRight'); await k(p, 'Enter'); await k(p, 'Enter'); },
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
  // WP-D1 (bp-fidelity): the L4 feature page re-ported from bp: General, a healthy lens tab and one in trouble
  'page-general': async () => {},
  'page-lens-good': async (p) => { await k(p, '4'); },
  'page-lens-bad': async (p) => { await k(p, '6'); },
  // WP-C (bp-fidelity): the rail's flyouts - Agents with a run read in full, Plan's legend overview, View's window
  'fly-agents': async (p) => { await k(p, '0'); await p.click('[data-testid="blueprint-rail"] [data-k="agents"]'); await p.waitForTimeout(300); await p.click('[data-testid="blueprint-flyout"] [data-row^="run:"]'); },
  'fly-plan': async (p) => { await k(p, '0'); await p.click('[data-testid="blueprint-rail"] [data-k="plan"]'); },
  'fly-plan-feature': async (p) => { await k(p, '0'); await p.click('[data-testid="blueprint-rail"] [data-k="plan"]'); await p.waitForTimeout(300); await p.click('[data-testid="blueprint-flyout"] .wb-row.ft'); },
  'fly-view': async (p) => { await k(p, '0'); await p.click('[data-testid="blueprint-rail"] [data-k="view"]'); },
  // WP-D2 (bp-fidelity): the expanded timeline at now; travelled 14 weeks back (panel closed again: the plan as it
  // stood and the strip's travelled state); the hover card on a fixture at L1; the on-plan decision card; three picked
  'tl-open': async (p) => { await k(p, '0'); await k(p, 't'); },
  'tl-travel': async (p) => { await k(p, '0'); await k(p, 'Enter'); await k(p, 't'); await p.focus('[data-testid="blueprint-revisions"]'); for (let i = 0; i < 14; i++) await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300); await k(p, 'Escape'); },
  'tl-travel-open': async (p) => { await k(p, '0'); await k(p, 'Enter'); await k(p, 't'); await p.focus('[data-testid="blueprint-revisions"]'); for (let i = 0; i < 14; i++) await p.keyboard.press('ArrowLeft'); },
  'ov-hover': async (p) => {
    await k(p, '0'); await k(p, 'Enter');
    const b = await p.evaluate(() => { const r = document.querySelector('.bp-host')?.getBoundingClientRect(); return r ? { x: r.left + r.width * 0.42, y: r.top + r.height * 0.52 } : null; });
    if (b) for (let i = 0; i < 6; i++) { await p.mouse.move(b.x + i * 6, b.y + i * 2); await p.waitForTimeout(60); }
  },
  'ov-decision': async (p) => { await k(p, 'j'); await p.waitForTimeout(500); },
  'ov-select': async (p) => { for (let i = 0; i < 3; i++) { await k(p, '0'); await k(p, 'j'); await k(p, 'Space'); } },
  // WP-B (bp-fidelity): the findings ledger (L) - the In packs table with a done item open in the compare panel (a wide
  // window opens the first item itself; J walks and the panel follows), the change map mode, the backlog, the matrix
  // and the release tab
  'lg-triage': async (p) => { await k(p, 'l'); for (let i = 0; i < 3; i++) await k(p, 'j'); await p.waitForTimeout(600); },
  'lg-map': async (p) => { await k(p, 'l'); for (let i = 0; i < 3; i++) await k(p, 'j'); for (let i = 0; i < 3; i++) await k(p, 'm'); await p.waitForTimeout(1500); },
  'lg-backlog': async (p) => { await k(p, 'l'); await p.click('[data-testid="blueprint-ledger-filters"] .tr-seg .tr-seg-b:nth-child(2)'); await k(p, 'j'); await k(p, 'Space'); await k(p, 'j'); await k(p, 'Space'); },
  'lg-matrix': async (p) => { await k(p, 'l'); await k(p, '2'); },
  'lg-release': async (p) => { await k(p, 'l'); await k(p, '3'); },
  // /perfect wave 1, lot A: a build this sheet started, followed on the fleet (the system store's session registry,
  // fed here by hand): queued with no session, running, failed; its Agents row and detail, the console line, the queue row
  'live-started-queued': async (p) => { await liveStart(p, null); },
  'live-started-running': async (p) => { await liveStart(p, { state: 'running', exitCode: null }); },
  'live-started-failed': async (p) => { await liveStart(p, { state: 'exited', exitCode: 1 }); },
  // /perfect wave 2, lot D: the store moves under the open sheet (three proposals decided elsewhere, so the sheet did not
  // send them): the chip, the one-shot mark on the plan and the queue rows; and the chip's list open on its 3 entries
  'live-changed': async (p) => { await feedChanges(p); },
  'live-changed-open': async (p) => { await feedChanges(p); await p.click('[data-testid="blueprint-changes-chip"]'); await p.waitForTimeout(200); },
  // spark roadmap S3: the decision brief on a waiting card. The repeat (fixture/briefDemo.ts, ?brief=demo): Decline
  // first, Approve anyway; its decline prompt pre-filled with the note naming the decision it repeats. The ask (Kettle's
  // own kf-001): the decline of a like idea elsewhere in amber, its evidence open, Approve first.
  'brief-repeat': async (p) => { await briefCard(p, 'kf-010'); },
  'brief-repeat-options': async (p) => { await briefCard(p, 'kf-010', 'end'); },
  'brief-repeat-prompt': async (p) => { await briefCard(p, 'kf-010'); await p.click('article[data-item="kf-010"] [data-testid="blueprint-decline"]'); },
  'brief-ask-options': async (p) => { await briefCard(p, 'kf-001', 'end'); },
  'brief-ask': async (p) => { await briefCard(p, 'kf-001'); await p.click('article[data-item="kf-001"] [data-fact="declined"] button'); },
};

/** Bring a waiting card's brief (or with `end`, its answers) into view on its feature's L4 sheet: scroll the sheet's
 *  own pane only (scrolling every ancestor, as scrollIntoView does, moves the page under the fixed sheet). */
async function briefCard(p, id, end = false) {
  await p.waitForSelector(`article[data-item="${id}"]`, { timeout: 10_000 });
  await p.evaluate(([sel, toEnd]) => {
    const el = document.querySelector(sel);
    let pane = el?.parentElement;
    while (pane && !(pane.scrollHeight > pane.clientHeight && /(auto|scroll)/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement;
    if (!el || !pane) return;
    const r = el.getBoundingClientRect(), q = pane.getBoundingClientRect();
    pane.scrollTop += toEnd ? r.bottom - q.bottom + 24 : r.top - q.top - 24;
  }, [`article[data-item="${id}"]`, end]);
  await p.waitForTimeout(200);
}

/**
 * Select the first waiting item (the camera flies to it), decide it and two others straight on the fixture store (not
 * through the sheet), move the page clock past the live refresh's throttle and let the window regain focus: the sheet
 * re-reads and finds news.
 */
async function feedChanges(p) {
  await k(p, 'j');
  await p.evaluate(async () => {
    const a = window.__BLUEPRINT__.actions, cur = document.querySelector('[data-item][aria-current="true"]')?.getAttribute('data-item');
    const waiting = a.snapshot().proposals.filter((x) => x.status === 'proposed').map((x) => x.id);
    const ids = [cur, ...waiting.filter((id) => id !== cur)].filter(Boolean).slice(0, 3);
    await a.decide(ids.slice(0, 2), 'approve');
    await a.decide(ids.slice(2), 'decline', 'Superseded');
  });
  await p.clock.setFixedTime(new Date(Date.parse(NOW) + 20_000));
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForSelector('[data-testid="blueprint-changes-chip"]', { timeout: 10_000 });
  await p.waitForTimeout(150);
}

/** Approve and build the first item, optionally give its start one fleet session, open the start in the Agents panel. */
async function liveStart(p, session) {
  await k(p, 'j'); await k(p, 'a'); await k(p, 'b'); await k(p, 'b');
  if (session) {
    const label = await p.evaluate(() => document.querySelector('[data-testid="blueprint-start-state"]')?.getAttribute('data-label') ?? null);
    if (label) await p.evaluate(async ([l, over]) => {
      const m = await import('/src/stores/systemStore.ts');
      m.useSystemStore.setState({ fleetSessions: [{ id: 'shot-session', runLabel: 'fleet-door:lens_scan:' + l, createdAtMs: Date.now() - 95_000, lastActivityMs: Date.now() - 5_000, ...over }] });
    }, [label, session]);
    await p.waitForTimeout(400);
  }
  await p.click('[data-testid="blueprint-rail"] [data-k="agents"]');
  await p.waitForTimeout(300);
  await p.click('[data-testid="blueprint-flyout"] [data-row^="start:"]');
}

/** The feature a state opens on (`?feature=`), its L4 sheet open at once. */
const FEATURE = {
  'state-compare': 'book-a-class', 'state-compare-perf': 'drag-and-drop-timetable-editor', 'state-rework-prompt': 'book-a-class',
  'state-reopen-refused': 'studio-kpi-dashboard', 'state-in-release': 'revenue-reports',
  'page-general': 'tax-handling', 'page-lens-good': 'tax-handling', 'page-lens-bad': 'tax-handling',
  'brief-repeat': 'book-for-friends-family', 'brief-repeat-options': 'book-for-friends-family', 'brief-repeat-prompt': 'book-for-friends-family',
  'brief-ask': 'member-mobile-app', 'brief-ask-options': 'member-mobile-app',
};
/** Extra harness query per state. */
const QUERY = { 'brief-repeat': 'brief=demo', 'brief-repeat-options': 'brief=demo', 'brief-repeat-prompt': 'brief=demo' };
/**
 * States shot on the real clock. A fixed page clock also fixes performance.now, so framer-motion's entrance never
 * advances and BaseModal's panel (the whole sheet) stays at its initial opacity 0: measured 2026-10-30, every state
 * shot blank. The brief reads no clock, so its states skip the fixed time; the others still need it (an open question
 * for whoever owns this harness).
 */
const REAL_CLOCK = new Set(['brief-repeat', 'brief-repeat-options', 'brief-repeat-prompt', 'brief-ask', 'brief-ask-options']);
/** Frames taken at every size: the levels and the compare panel. */
const EVERY_SIZE = new Set([...LEVELS, 'state-compare', 'page-general', 'page-lens-good', 'page-lens-bad', 'fly-agents', 'live-started-running', 'fly-plan', 'fly-view', 'tl-open', 'tl-travel', 'tl-travel-open', 'live-changed', 'live-changed-open', 'ov-hover', 'ov-decision', 'ov-select', 'lg-triage', 'lg-matrix', 'lg-release']);

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
      if (!REAL_CLOCK.has(name)) await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((t) => { window.__PAGE_HARNESS_TAPE__ = t; }, tape);
      await page.addInitScript(CANVAS_PROBE);
      const url = `${server.url}${HARNESS}?module=decision-center/blueprint&theme=${theme}${FEATURE[name] ? '&feature=' + FEATURE[name] : ''}${QUERY[name] ? '&' + QUERY[name] : ''}`;
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
