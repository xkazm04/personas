#!/usr/bin/env node
// Screenshot a WebGL/2D <canvas> in the RUNNING app by reading the frame back
// from inside the page, over the test-automation server on :17320.
//
// ─── WHY THIS EXISTS, AND WHY IT IS NOT AN OS SCREENSHOT ────────────────────
// Written 2026-09-09 while auditioning the Mastermind 3D worlds, where being
// able to LOOK at a build caught two defects the DOM could not show: a camera
// that framed ten projects into a third of the viewport, and per-project
// outlines that turned into visual noise once repeated ten times. Neither is
// visible to /query, and both were fixed only because a frame was captured.
//
// Four OS-level approaches were tried first. EVERY ONE OF THEM FAILED BY
// PRODUCING A PLAUSIBLE IMAGE RATHER THAN AN ERROR, which is the entire reason
// this file is the sanctioned route:
//
//   1. PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT) → a PURE BLACK bitmap of
//      exactly the right size. WebView2 stops compositing while the window is
//      occluded, so there is genuinely nothing in the window's backing store.
//   2. SetForegroundWindow(hwnd) + Graphics.CopyFromScreen → a screenshot of
//      THE TERMINAL. Windows refuses foreground activation from a background
//      process; the call reports that by returning false, which nothing checks,
//      and the grab then reads whatever is actually on top of that rectangle.
//   3. The test-automation server's own POST /screenshot → a WHOLE-MONITOR
//      grab. It resolves the window by TITLE SUBSTRING and silently falls back
//      to the primary monitor when it misses — and this window's title can be
//      an empty string, and its HWND changes across runs.
//   4. Any of the above while the app sits on a SECOND VIRTUAL DESKTOP, which
//      is where this operator usually keeps it → nothing on-screen to grab.
//
// The page, by contrast, can always see itself. `preserveDrawingBuffer: true`
// on the R3F <Canvas> keeps the frame readable after compositing; `toDataURL`
// encodes it; and the base64 comes back through /query in small chunks because
// that endpoint truncates each element's text at 300 characters.
//
// ─── HOUSEKEEPING ──────────────────────────────────────────────────────────
// Shots are DEVELOPMENT SCRAP, not artifacts. They default into `tmp/`, which
// is gitignored, and every capture run starts by clearing its own output
// directory so one step's frames can never be mistaken for the next step's.
// Pass --keep to accumulate deliberately (a before/after pair, say).
//
// Usage:
//   node scripts/capture-canvas.mjs --name strata-L0
//   node scripts/capture-canvas.mjs --selector '.mm3d canvas' --out tmp/foo
//   node scripts/capture-canvas.mjs --clean            # wipe and exit
//
// Programmatic:
//   import { captureCanvas, clearShots } from './capture-canvas.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// An env var that is SET BUT EMPTY (a blank `.env` line, a blank CI
// expression) means "not configured", not "configure me with an empty URL" —
// so trim and test for content rather than reaching for `??`, which only sees
// null/undefined.
const BRIDGE = (process.env.TEST_AUTOMATION_URL || '').trim() || 'http://127.0.0.1:17320';
export const DEFAULT_OUT = 'tmp/canvas-shots';
const DEFAULT_SELECTOR = 'canvas';
/** /query truncates each element's text at 300 chars — stay well under it. */
const CHUNK = 280;

const post = async (route, body) => {
  const res = await fetch(BRIDGE + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is the app up with the test-automation feature? */
export async function bridgeReady() {
  try {
    const res = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Empty `dir` (creating it if absent).
 *
 * Removes and recreates rather than listing and deleting per file: this tool
 * has no gate over a directory listing, and a script that enumerates while
 * also being able to exit non-zero owes the reader a difference between
 * "found nothing" and "looked at nothing" (census: gate-without-empty-input-guard).
 * There is no such question here — the directory just has to end up empty —
 * so the enumeration is the wrong tool, not a guard waiting to be written.
 */
export function clearShots(dir = DEFAULT_OUT) {
  const abs = resolve(dir);
  rmSync(abs, { recursive: true, force: true });
  mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * Capture `selector` and write it to `<out>/<name>.jpg`.
 *
 * Resolves `{ ok: false, reason }` rather than throwing, because the common
 * failures are states of the app (wrong route open, canvas not mounted yet)
 * that a caller usually wants to log and carry on from.
 */
export async function captureCanvas({
  name,
  out = DEFAULT_OUT,
  selector = DEFAULT_SELECTOR,
  width = 1200,
  quality = 0.75,
} = {}) {
  if (!name) return { ok: false, reason: 'no name given' };
  const abs = resolve(out);
  mkdirSync(abs, { recursive: true });

  // Everything below runs INSIDE the page. /eval is fire-and-forget (it returns
  // {success:true} with no result), so the payload is stashed in hidden DOM
  // nodes and fetched back with /query.
  const js = `(() => {
    document.querySelectorAll('.__shotchunk, .__shothost').forEach((n) => n.remove());
    const mark = (t) => { const s = document.createElement('span'); s.className = '__shotchunk'; s.textContent = t; document.body.appendChild(s); };
    const src = document.querySelector(${JSON.stringify(selector)});
    if (!src) return mark('ERR:no-element');
    if (!src.width || !src.height) return mark('ERR:zero-size');
    let url;
    try {
      const scale = ${width} / src.width;
      const c = document.createElement('canvas');
      c.width = ${width};
      c.height = Math.max(1, Math.round(src.height * scale));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', ${quality});
    } catch (e) {
      // A WebGL canvas without preserveDrawingBuffer reads back BLANK rather
      // than throwing; a tainted one throws here. Both are worth naming.
      return mark('ERR:' + (e && e.message ? e.message : 'toDataURL failed'));
    }
    const data = url.slice(url.indexOf(',') + 1);
    const host = document.createElement('div');
    host.className = '__shothost';
    host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden';
    for (let i = 0; i < data.length; i += ${CHUNK}) {
      const s = document.createElement('span');
      s.className = '__shotchunk';
      s.textContent = data.slice(i, i + ${CHUNK});
      host.appendChild(s);
    }
    document.body.appendChild(host);
  })()`;

  await post('/eval', { js });
  await sleep(400);
  const rows = await post('/query', { selector: '.__shotchunk' });
  const cleanup = () => post('/eval', { js: `document.querySelectorAll('.__shotchunk, .__shothost').forEach((n) => n.remove())` });

  if (!Array.isArray(rows) || rows.length === 0) {
    await cleanup();
    return { ok: false, reason: 'no data came back (is the app running with --features test-automation?)' };
  }
  if (rows.length === 1 && typeof rows[0].text === 'string' && rows[0].text.startsWith('ERR:')) {
    const reason = rows[0].text.slice(4);
    await cleanup();
    return { ok: false, reason };
  }

  const b64 = rows.map((r) => r.text).join('');
  await cleanup();
  if (b64.length < 500) return { ok: false, reason: `payload too small (${b64.length} chars) — canvas probably blank` };

  const buf = Buffer.from(b64, 'base64');
  const file = join(abs, `${name}.jpg`);
  writeFileSync(file, buf);
  return { ok: true, file, bytes: buf.length, chunks: rows.length };
}

// ─── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const has = (n) => args.includes(`--${n}`);

  const out = flag('out', DEFAULT_OUT);

  if (has('clean')) {
    clearShots(out);
    console.log(`cleared ${out}`);
    process.exit(0);
  }

  if (!(await bridgeReady())) {
    console.error(`test-automation server not reachable at ${BRIDGE}`);
    console.error('Start the app with:  npm run tauri:dev:test');
    process.exit(1);
  }

  if (!has('keep')) clearShots(out);

  const result = await captureCanvas({
    name: flag('name', `shot-${Date.now()}`),
    out,
    selector: flag('selector', DEFAULT_SELECTOR),
    width: Number(flag('width', '1200')),
    quality: Number(flag('quality', '0.75')),
  });

  if (!result.ok) {
    console.error(`capture failed: ${result.reason}`);
    process.exit(1);
  }
  console.log(`${result.file}  (${(result.bytes / 1024).toFixed(1)} KB)`);
}
