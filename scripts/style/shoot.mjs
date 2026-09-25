#!/usr/bin/env node
// Page-shot harness driver: BEFORE/AFTER screenshot pairs of one module's real
// page inside the app shell's geometry, rendered on the SAME replayed IPC data,
// so a pixel delta means the code changed and not the data.
//
// Why not a screenshot of the running app: scripts/capture-canvas.mjs records
// four OS-level approaches that silently produced plausible wrong images
// (black bitmap, the terminal, the whole monitor, a second virtual desktop).
// This renders the page in headless Chromium through the repo's own Vite
// config instead: scripts/style/page-harness/ (tape player + registry + frame).
//
// Usage:
//   node scripts/style/shoot.mjs --module overview/sub_events --tape synthetic --out tmp/style-shots/events --label before
//   node scripts/style/shoot.mjs --module home/sub_releases --tape tmp/style-shots/m1/tape.json --out tmp/style-shots/m1 --label after
//   node scripts/style/shoot.mjs --pair <before-dir> <after-dir> --out <dir>
//   node scripts/style/shoot.mjs --self-test          # proves empty-mount and console-error both fail
//   node scripts/style/shoot.mjs --serve [--port 1432] # keep the harness up for a browser
//
// Options: --sizes 1280x800,1920x1080  --themes dark-midnight,light  --settle 1500  --tz UTC
//          --brightness low|mid|high (default: the store default, as a fresh profile gets)
//          --strict-ipc (fail on IPC commands missing from the tape)
//
// Output (per --label): <label>-<W>x<H>-<theme>.png for each size x theme, <label>-report.json
// (console errors, unknown IPC commands, args mismatches, text length, page dimensions),
// and tape.json (the exact tape used; pass it back as --tape for the other half of the pair).
// Exit 1 on a console error, a harness/render error, or an empty mount.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSyntheticTape } from './page-harness/synthetic-tapes.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS_PATH = '/scripts/style/page-harness/index.html';
const MIN_TEXT = 40;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

async function startServer(preferredPort) {
  const { createServer } = await import('vite');
  for (let port = preferredPort; port < preferredPort + 10; port++) {
    try {
      const server = await createServer({
        configFile: join(REPO, 'vite.config.ts'),
        root: REPO,
        // Own dep cache per port: never re-optimize under the dev server on
        // :1420, nor under a concurrent shoot on another port.
        cacheDir: join(REPO, 'node_modules', `.vite-page-harness-${port}`),
        logLevel: 'warn',
        clearScreen: false,
        optimizeDeps: { entries: [HARNESS_PATH.slice(1)] },
        // forwardConsole off: the report collects the page's console itself.
        server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null, forwardConsole: false },
      });
      await server.listen();
      return { server, url: `http://127.0.0.1:${port}` };
    } catch (err) {
      if (!/port .* in use|EADDRINUSE/i.test(String(err?.message ?? err))) throw err;
    }
  }
  throw new Error(`no free port in ${preferredPort}..${preferredPort + 9}`);
}

/**
 * Playwright's pinned headless shell when installed; otherwise the newest
 * `chromium_headless_shell-*` already in the ms-playwright cache (measured
 * 2026-09-24: playwright 1.59.1 wants build 1217, this machine has 1169..1243
 * but not 1217). Never a system Chrome: it auto-updates between a BEFORE and an
 * AFTER run, and a renderer change must not read as a style change. The
 * version lands in every report and --pair refuses a mismatch.
 */
async function launchBrowser() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch();
  } catch (err) {
    if (!/Executable doesn't exist/.test(String(err?.message))) throw err;
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const builds = (existsSync(cache) ? readdirSync(cache) : [])
      .map((d) => /^chromium_headless_shell-(\d+)$/.exec(d))
      .filter(Boolean)
      .map((m) => ({ dir: m[0], rev: Number(m[1]) }))
      .sort((a, b) => b.rev - a.rev);
    for (const b of builds) {
      const exe = join(cache, b.dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (existsSync(exe)) return chromium.launch({ executablePath: exe });
    }
    throw err;
  }
}

function loadTape(spec, moduleId) {
  if (!spec || spec === 'synthetic') return { tape: buildSyntheticTape(moduleId, REPO), path: 'synthetic' };
  const p = resolve(spec);
  return { tape: JSON.parse(readFileSync(p, 'utf8')), path: p };
}

function parseSizes(s) {
  return String(s).split(',').map((v) => {
    const [w, h] = v.split('x').map(Number);
    if (!w || !h) throw new Error(`bad size "${v}"`);
    return { width: w, height: h };
  });
}

async function shootOne(browser, baseUrl, { moduleId, theme, size, tape, settle, tz, brightness }) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, locale: 'en-US', timezoneId: tz });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 2000)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e?.message ?? e).slice(0, 2000)}`));
  await page.clock.setFixedTime(new Date(tape.recordedAt));
  await page.addInitScript((t) => { window.__PAGE_HARNESS_TAPE__ = t; }, tape);
  const url = `${baseUrl}${HARNESS_PATH}?module=${encodeURIComponent(moduleId)}&theme=${encodeURIComponent(theme)}${brightness ? `&brightness=${brightness}` : ''}`;
  // 'commit', not 'load': on a cold dep cache Vite holds module requests while
  // it pre-bundles (measured 37 s on the first run), which would trip goto's
  // own timeout before the harness has had a chance to report anything.
  await page.goto(url, { waitUntil: 'commit' });
  let harness = null;
  try {
    await page.waitForFunction(() => { const h = window.__PAGE_HARNESS__; return !!h && (h.mounted || !!h.error); }, null, { timeout: 180_000 });
  } catch {
    consoleErrors.push('harness never reported mounted or error within 180s');
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(settle);
  harness = await page.evaluate(() => window.__PAGE_HARNESS__ ?? null);
  const probe = await page.evaluate(() => {
    const main = document.getElementById('main-content');
    const r = main?.getBoundingClientRect();
    return {
      text: (main?.innerText ?? '').replace(/\s+/g, ' ').trim(),
      errorBox: !!document.querySelector('[data-harness="error"]'),
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      main: r ? { width: Math.round(r.width), height: Math.round(r.height), scrollWidth: main.scrollWidth, scrollHeight: main.scrollHeight } : null,
    };
  });
  // CSS animations are frozen by Playwright; JS-driven motion (framer-motion)
  // is not, so shoot until two consecutive frames match.
  let png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  let stable = false;
  for (let i = 0; i < 8 && !stable; i++) {
    await page.waitForTimeout(400);
    const next = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    stable = next.equals(png);
    png = next;
  }
  await context.close();
  return { png, stable, consoleErrors, harness, probe };
}

async function runShoot() {
  const moduleId = args.module;
  const outDir = args.out && args.out !== true ? resolve(args.out) : null;
  const label = args.label && args.label !== true ? args.label : 'before';
  if (!moduleId || !outDir) throw new Error('--module <id> and --out <dir> are required');
  const { tape, path: tapePath } = loadTape(args.tape, moduleId);
  const sizes = parseSizes(args.sizes && args.sizes !== true ? args.sizes : '1280x800,1920x1080');
  const themes = String(args.themes && args.themes !== true ? args.themes : 'dark-midnight,light').split(',');
  const settle = Number(args.settle) || 1500;
  const tz = args.tz && args.tz !== true ? args.tz : 'UTC';
  const brightness = args.brightness && args.brightness !== true ? args.brightness : null;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'tape.json'), JSON.stringify(tape, null, 2));

  const browser = await launchBrowser();
  const { server, url } = await startServer(Number(args.port) || 1432);
  const browserVersion = browser.version();
  const shots = [];
  try {
    // Warm-up render, discarded. Measured 2026-09-24: the FIRST shot of a run
    // differed from the same view in a re-run by 17 px of anti-aliasing in the
    // header icon while every later shot was byte-identical; a throwaway first
    // render makes every kept shot a warm one.
    await shootOne(browser, url, { moduleId, theme: themes[0], size: sizes[0], tape, settle: 300, tz, brightness });
    for (const theme of themes) {
      for (const size of sizes) {
        const r = await shootOne(browser, url, { moduleId, theme, size, tape, settle, tz, brightness });
        const file = `${label}-${size.width}x${size.height}-${theme}.png`;
        writeFileSync(join(outDir, file), r.png);
        const problems = [];
        if (r.consoleErrors.length) problems.push(`${r.consoleErrors.length} console error(s)`);
        if (r.harness?.error) problems.push(`harness error: ${r.harness.error}`);
        if (r.probe.errorBox) problems.push('error boundary rendered');
        if (!r.harness?.mounted) problems.push('page never mounted');
        if (r.probe.text.length < MIN_TEXT) problems.push(`empty mount: #main-content has ${r.probe.text.length} chars of text (< ${MIN_TEXT})`);
        if (args['strict-ipc'] && r.harness?.unknown?.length) problems.push(`${r.harness.unknown.length} IPC command(s) missing from the tape`);
        shots.push({
          file, theme, size, ok: problems.length === 0, problems,
          consoleErrors: r.consoleErrors,
          unknownIpc: r.harness?.unknown ?? [],
          argsMismatch: r.harness?.argsMismatch ?? [],
          ipcHits: r.harness?.hits ?? {},
          stable: r.stable,
          textLength: r.probe.text.length,
          textSample: r.probe.text.slice(0, 200),
          dims: { document: r.probe.document, main: r.probe.main },
        });
        console.log(`${problems.length ? 'FAIL' : 'ok  '} ${file}${r.stable ? '' : '  (still moving after 8 frames: a looping animation?)'}${problems.length ? '  ' + problems.join('; ') : ''}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const unknownCmds = [...new Set(shots.flatMap((s) => s.unknownIpc.map((u) => u.cmd)))];
  const report = {
    module: moduleId, label, createdAt: new Date().toISOString(), browser: browserVersion,
    tape: { path: tapePath, source: tape.source, recordedAt: tape.recordedAt, calls: tape.calls.length, note: tape.note ?? null },
    ok: shots.every((s) => s.ok), unknownIpcCommands: unknownCmds, shots,
  };
  writeFileSync(join(outDir, `${label}-report.json`), JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  if (unknownCmds.length) console.log(`IPC commands not on the tape (answered with defaults): ${unknownCmds.join(', ')}`);
  console.log(`report: ${join(outDir, `${label}-report.json`)}`);
  return report.ok ? 0 : 1;
}

async function runPair() {
  const [beforeDir, afterDir] = args._.length >= 2 ? args._ : [args.pair, args._[0]];
  const outDir = args.out && args.out !== true ? resolve(args.out) : null;
  if (!beforeDir || !afterDir || !outDir) throw new Error('--pair <before-dir> <after-dir> --out <dir>');
  const pick = (dir) => Object.fromEntries(readdirSync(dir)
    .map((f) => [f, /^[^-]+-(\d+x\d+-.+)\.png$/.exec(f)])
    .filter(([, m]) => m)
    .map(([f, m]) => [m[1], join(dir, f)]));
  const before = pick(resolve(beforeDir));
  const after = pick(resolve(afterDir));
  const views = Object.keys(before).filter((v) => after[v]);
  const orphans = [...Object.keys(before), ...Object.keys(after)].filter((v) => !(before[v] && after[v]));
  if (!views.length) throw new Error(`no matching views between ${beforeDir} and ${afterDir}`);
  const browserOf = (dir) => readdirSync(dir).filter((f) => f.endsWith('-report.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')).browser; } catch { return null; } })
    .find(Boolean) ?? null;
  const [bv, av] = [browserOf(resolve(beforeDir)), browserOf(resolve(afterDir))];
  if (bv && av && bv !== av && !args['allow-browser-drift']) {
    console.error(`renderer drift: before shot with ${bv}, after with ${av}; re-shoot one side or pass --allow-browser-drift`);
    return 1;
  }
  mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const title = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'tape.json'), 'utf8')).module ?? ''; } catch { return ''; } };
  const moduleName = title(resolve(beforeDir)) || title(resolve(afterDir));
  const deltas = {};
  try {
    for (const view of views) {
      const [, w, h] = /^(\d+)x(\d+)/.exec(view).map(Number);
      const gap = 16, strip = 44;
      const page = await browser.newPage({ viewport: { width: w * 2 + gap, height: h + strip }, deviceScaleFactor: 1 });
      const src = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#111;font:600 15px/1 system-ui,sans-serif;color:#eee">
        <div style="display:flex;gap:${gap}px;height:${strip}px;align-items:center">
          <div style="width:${w}px;padding:0 14px;box-sizing:border-box">BEFORE <span style="font-weight:400;opacity:.7">${basename(before[view])}</span></div>
          <div style="width:${w}px;padding:0 14px;box-sizing:border-box">AFTER <span style="font-weight:400;opacity:.7">${basename(after[view])}</span> <span id="delta" style="float:right;font-weight:400;opacity:.85"></span></div>
        </div>
        <div style="display:flex;gap:${gap}px"><img id="b" src="${src(before[view])}" width="${w}" height="${h}"><img id="a" src="${src(after[view])}" width="${w}" height="${h}"></div>
      </body></html>`);
      // Changed-pixel count and bounding box, so "nothing moved" is a number.
      const delta = await page.evaluate(async ({ w, h, label }) => {
        const read = async (id) => {
          const img = document.getElementById(id);
          await img.decode();
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, w, h).data;
        };
        const [b, a] = [await read('b'), await read('a')];
        let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let i = 0; i < b.length; i += 4) {
          if (b[i] !== a[i] || b[i + 1] !== a[i + 1] || b[i + 2] !== a[i + 2]) {
            n++;
            const p = i / 4, x = p % w, y = (p - x) / w;
            if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
          }
        }
        const bbox = n ? [x0, y0, x1, y1] : null;
        document.getElementById('delta').textContent = `${label} · ${n ? `${n} px changed (${(100 * n / (w * h)).toFixed(2)}%)` : 'pixel-identical'}`;
        return { changedPixels: n, changedPct: Number((100 * n / (w * h)).toFixed(3)), bbox };
      }, { w, h, label: `${moduleName} · ${view}` });
      const file = join(outDir, `pair-${view}.png`);
      await page.screenshot({ path: file });
      await page.close();
      deltas[view] = delta;
      console.log(`pair ${file}  ${delta.changedPixels ? `${delta.changedPixels} px changed` : 'pixel-identical'}`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(outDir, 'pair-report.json'), JSON.stringify({ module: moduleName, before: resolve(beforeDir), after: resolve(afterDir), browser: { before: bv, after: av }, views: deltas }, null, 2));
  if (orphans.length) { console.error(`views without a counterpart: ${[...new Set(orphans)].join(', ')}`); return 1; }
  return 0;
}

async function runSelfTest() {
  const base = resolve(REPO, 'tmp', 'style-shots', '__selftest');
  const cases = ['__selftest/empty', '__selftest/console-error'];
  let caught = 0;
  for (const moduleId of cases) {
    const code = await (async () => {
      Object.assign(args, { module: moduleId, tape: 'synthetic', out: join(base, moduleId.split('/')[1]), label: 'probe', sizes: '1280x800', themes: 'dark-midnight' });
      return runShoot();
    })();
    console.log(`${moduleId}: exit ${code} (${code !== 0 ? 'caught, as it must be' : 'NOT CAUGHT'})`);
    if (code !== 0) caught++;
  }
  return caught === cases.length ? 0 : 1;
}

async function runServe() {
  const { url } = await startServer(Number(args.port) || 1432);
  console.log(`harness: ${url}${HARNESS_PATH}?module=<id>&theme=<theme>&tape=<url of a tape under the repo, e.g. /tmp/style-tapes/x.json>`);
}

const main = args['self-test'] ? runSelfTest : args.pair ? runPair : args.serve ? runServe : runShoot;
main().then((code) => { if (code !== undefined) process.exitCode = code; }, (err) => { console.error(err?.stack ?? String(err)); process.exitCode = 1; });

