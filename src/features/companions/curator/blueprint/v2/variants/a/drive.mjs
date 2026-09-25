/* Verification driver (not part of the variant): drives the harness in real
 * Chrome at both sizes in both themes and reports what it observed. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:1437/src/features/companions/curator/blueprint/v2/variants/a/harness.html';
const OUT = 'C:/Users/kazda/AppData/Local/Temp/claude/shots-a';
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  { name: 'dark-1000x640', theme: 'dark-midnight', w: 1000, h: 640 },
  { name: 'dark-1920x1080', theme: 'dark-midnight', w: 1920, h: 1080 },
  { name: 'light-1000x640', theme: 'light', w: 1000, h: 640 },
  { name: 'light-1920x1080', theme: 'light', w: 1920, h: 1080 },
  { name: 'dark-1000x640-live', theme: 'dark-midnight', w: 1000, h: 640, live: true },
  { name: 'light-1000x640-live', theme: 'light', w: 1000, h: 640, live: true },
];

const browser = await chromium.launch({ channel: 'chrome' });
const report = [];

for (const c of CASES) {
  // The harness frame reproduces the app shell inside the viewport: 88 + 240px
  // rails and a 48px titlebar, so a 1000x640 content area needs 1328x688.
  const page = await browser.newPage({ viewport: { width: c.w + 328, height: c.h + 48 } });
  // A browser has no Tauri runtime. Stub the bridge with the DATABASE'S OWN
  // ANSWER today: `curator_plan_current` returns null (no projection has ever
  // been made) and `curator_requests_list` returns [] (nothing is filed). So
  // the `live` feed shows the two real empty states, and nothing is faked.
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => { window.__cbid = (window.__cbid ?? 0) + 1; return window.__cbid; },
      invoke: (cmd) => Promise.resolve(cmd === 'curator_requests_list' ? [] : null),
      metadata: {},
      plugins: {},
    };
  });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} | ${(e.stack ?? '').split('\n')[1] ?? ''}`));
  await page.goto(`${BASE}?theme=${c.theme}`, { waitUntil: 'networkidle' });
  if (c.live) {
    await page.getByRole('button', { name: /^live$/ }).click();
    // The IPC wrapper waits up to 2s for a session token before it invokes.
    await page.waitForSelector('.k-empty', { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${c.name}.png` });
    const emptyText = await page.evaluate(() => [...document.querySelectorAll('.k-empty')].map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 130)));
    const liveErrors = errors.slice();
    report.push({ case: c.name, live: emptyText, errors: liveErrors, cols: [], sig: {}, ruler: {}, inks: {}, slotVsNumLeft: 0, docScrollW: 0, docClientW: 0, mainScrollW: 0, mainClientW: 0 });
    await page.close();
    continue;
  }
  await page.waitForSelector('.k-row .bpa-sig', { timeout: 15000 });
  await page.waitForTimeout(700);

  const stats = await page.evaluate(() => {
    const main = document.querySelector('#main-content');
    const cols = [...document.querySelectorAll('.bpa__col')];
    const perCol = cols.map((col) => {
      const box = col.getBoundingClientRect();
      const rows = [...col.querySelectorAll('.k-row')];
      const fully = rows.filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top >= box.top - 1 && b.bottom <= box.bottom + 1;
      });
      return {
        total: rows.length,
        fullyVisible: fully.length,
        w: Math.round(box.width),
        h: Math.round(box.height),
        scrollH: col.scrollHeight,
        scrolls: col.scrollHeight > col.clientHeight + 1,
        rowH: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
      };
    });
    const sig = document.querySelector('.k-row .bpa-sig');
    const sigBox = sig.getBoundingClientRect();
    const ruler = document.querySelector('.bpa__col .bpa-ruler');
    const rulerBox = ruler.getBoundingClientRect();
    const firstSlot = sig.querySelector('.bpa-slot').getBoundingClientRect();
    const firstNum = ruler.querySelector('.bpa-ruler__n').getBoundingClientRect();
    const count = (s) => document.querySelectorAll(s).length;
    const ink = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el, '::after');
      return { h: cs.height, w: cs.width, bg: cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage.slice(0, 60) };
    };
    return {
      mainScrollW: main.scrollWidth, mainClientW: main.clientWidth,
      docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
      cols: perCol,
      sig: { w: Math.round(sigBox.width), h: Math.round(sigBox.height), right: Math.round(sigBox.right) },
      ruler: { right: Math.round(rulerBox.right) },
      slotVsNumLeft: Math.round(firstSlot.left - firstNum.left),
      inks: {
        scored: count('.bpa-slot--scored'), zero: count('.bpa-slot--zero'),
        unknown: count('.bpa-slot--unknown'), unmeasurable: count('.bpa-slot--unmeasurable'),
      },
      inkStyles: {
        scored: ink('.k-row .bpa-slot--scored'), zero: ink('.k-row .bpa-slot--zero'),
        unknown: ink('.k-row .bpa-slot--unknown'), unmeasurable: ink('.k-row .bpa-slot--unmeasurable'),
      },
      // Nothing may render a bare "0" that was not measured as zero.
      bareZeroCells: [...document.querySelectorAll('.bpa-pts')].filter((n) => n.textContent.trim() === '0').length,
      flatlineRows: [...document.querySelectorAll('.k-row')]
        .filter((r) => r.querySelectorAll('.bpa-slot--zero').length === 9).length,
    };
  });

  await page.screenshot({ path: `${OUT}/${c.name}.png` });

  const sig = page.locator('.k-row .bpa-sig').first();
  await sig.hover();
  await page.waitForTimeout(600);
  const tipText = await page.evaluate(() => {
    const tip = document.querySelector('.bpa-tip');
    return tip ? (tip.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300) : null;
  });
  await page.screenshot({ path: `${OUT}/${c.name}-hover.png` });

  await page.mouse.move(2, 2);
  await sig.focus();
  await page.waitForTimeout(500);
  const focusOk = await page.evaluate(() => ({
    cls: document.activeElement?.className ?? '',
    tip: !!document.querySelector('.bpa-tip'),
  }));
  await page.screenshot({ path: `${OUT}/${c.name}-focus.png` });

  report.push({ case: c.name, ...stats, tipText, focusOk, errors });
  await page.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
for (const r of report) {
  console.log('###', r.case);
  if (r.live) { console.log('  live empty states:', JSON.stringify(r.live)); console.log('  errors', r.errors.length, r.errors); continue; }
  for (const [i, c] of r.cols.entries()) {
    console.log(`  col${i}: ${c.fullyVisible}/${c.total} rows fully visible, ${c.w}x${c.h}, rowH ${c.rowH}, scrolls ${c.scrolls} (${c.scrollH})`);
  }
  console.log('  sig', `${r.sig.w}x${r.sig.h}`, 'right', r.sig.right, '| ruler right', r.ruler.right, '| slot-vs-number left delta', r.slotVsNumLeft);
  console.log('  inks', JSON.stringify(r.inks), 'flatline rows', r.flatlineRows, 'bare-zero figures', r.bareZeroCells);
  console.log('  ink styles', JSON.stringify(r.inkStyles));
  console.log('  overflow doc', r.docScrollW, '/', r.docClientW, 'main', r.mainScrollW, '/', r.mainClientW);
  console.log('  focus', JSON.stringify(r.focusOk));
  console.log('  tip', (r.tipText ?? 'NONE').slice(0, 200));
  console.log('  errors', r.errors.length, r.errors.slice(0, 4));
}
