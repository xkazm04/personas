#!/usr/bin/env node
// Measures what the kit's type tokens RENDER, against the app's real stylesheet,
// across every text scale the appearance setting offers, in three hosts: outside
// the kit, inside a plain kit host, inside a compact kit host.
//
// Written 2026-10-03 to settle a claim rather than argue it. The owner, reviewing
// Home: "Kit typography does not reflect font size from appearance setting,
// overall is too small comparing to existing app fonts."
//
// Usage: node scripts/style/kit-type-probe/run.mjs [--port 1434] [--json]
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROBE_PATH = '/scripts/style/kit-type-probe/index.html';
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
  a.startsWith('--') ? [[a.slice(2), arr[i + 1]?.startsWith('--') === false ? arr[i + 1] : true]] : []));

async function startServer(preferredPort) {
  const { createServer } = await import('vite');
  for (let port = preferredPort; port < preferredPort + 10; port++) {
    try {
      const server = await createServer({
        configFile: join(REPO, 'vite.config.ts'), root: REPO,
        cacheDir: join(REPO, 'node_modules', `.vite-kit-type-probe-${port}`),
        logLevel: 'warn', clearScreen: false,
        optimizeDeps: { entries: [PROBE_PATH.slice(1)] },
        server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
      });
      await server.listen();
      return { server, url: `http://127.0.0.1:${port}` };
    } catch (err) {
      if (!/port .* in use|EADDRINUSE/i.test(String(err?.message ?? err))) throw err;
    }
  }
  throw new Error(`no free port in ${preferredPort}..${preferredPort + 9}`);
}

async function launchBrowser() {
  const { chromium } = await import('playwright');
  try { return await chromium.launch(); } catch (err) {
    if (!/Executable doesn't exist/.test(String(err?.message))) throw err;
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const builds = (existsSync(cache) ? readdirSync(cache) : [])
      .map((d) => /^chromium_headless_shell-(\d+)$/.exec(d)).filter(Boolean)
      .map((m) => ({ dir: m[0], rev: Number(m[1]) })).sort((a, b) => b.rev - a.rev);
    for (const b of builds) {
      const exe = join(cache, b.dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (existsSync(exe)) return chromium.launch({ executablePath: exe });
    }
    throw err;
  }
}

const { server, url } = await startServer(Number(args.port || 1434));
const browser = await launchBrowser();
let res;
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${url}${PROBE_PATH}`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => !!window.__kitTypeProbe, null, { timeout: 180000 });
  res = await page.evaluate(() => window.__kitTypeProbe());
  if (errors.length) throw new Error(`probe page errors: ${errors.join(' | ')}`);
} finally {
  await browser.close();
  await server.close();
}

if (args.json) { console.log(JSON.stringify(res, null, 2)); process.exit(0); }

const { tokens, scales, rootPx, out } = res;
console.log('\nroot font-size by appearance setting:');
console.log('  ' + scales.map((s) => `${s} ${rootPx[s]}px`).join('   '));

for (const t of tokens) {
  console.log(`\n${t}`);
  console.log('  scale      app      kit    kit-compact   compact vs app');
  for (const s of scales) {
    const r = out[s][t];
    const d = r.app ? (((r['kit-compact'] - r.app) / r.app) * 100).toFixed(1) : '0';
    console.log(`  ${s.padEnd(9)} ${String(r.app).padStart(6)}  ${String(r.kit).padStart(6)}  ${String(r['kit-compact']).padStart(10)}   ${d}%`);
  }
}

// The two questions, answered.
const scalesMove = (host) => tokens.every((t) => new Set(scales.map((s) => out[s][t][host])).size === scales.length);
console.log('\n--- verdict ---');
console.log(`token size tracks the appearance setting outside the kit : ${scalesMove('app')}`);
console.log(`token size tracks the appearance setting inside the kit  : ${scalesMove('kit')}`);
console.log(`token size tracks it inside a COMPACT kit host           : ${scalesMove('kit-compact')}`);
const d = out['default'];
console.log('\nat the "default" setting, compact vs app, per token:');
for (const t of tokens) {
  console.log(`  ${t.padEnd(20)} ${d[t].app}px -> ${d[t]['kit-compact']}px`);
}
