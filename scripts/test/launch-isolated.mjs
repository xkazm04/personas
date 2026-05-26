/**
 * Launch an ISOLATED dev instance of the Personas app for E2E tests that
 * need a fresh-user, empty-database starting point.
 *
 * Why this exists
 * ---------------
 * The Playwright tour specs (tests/playwright/tours-explore.spec.ts,
 * getting-started-tour.spec.ts) drive a *real* running app via the
 * test-automation HTTP bridge. Historically they ran against the single
 * shared dev instance on :17320, whose SQLite DB + WebView localStorage
 * carry whatever the developer's session left behind — so they prove "the
 * tour structurally walks", not "a brand-new user from an empty DB can
 * complete it".
 *
 * The 2026-05-26 multi-driver orchestration work shipped the env overrides
 * that make true isolation possible (see src-tauri/src/lib.rs:549,
 * src-tauri/src/test_automation.rs, src-tauri/src/engine/webhook.rs,
 * vite.config.ts):
 *
 *   PERSONAS_DATA_DIR    → isolated SQLite + user DB + engine-leader lock
 *   PERSONAS_VITE_PORT   → isolated Vite dev server (strictPort; HMR = +1)
 *   PERSONAS_TEST_PORT   → isolated test-automation bridge (+5 fallback)
 *   PERSONAS_WEBHOOK_PORT → isolated webhook server
 *
 * Single-instance is enforced ONLY in release builds (lib.rs:487), so a dev
 * build can run side-by-side with the developer's main instance. That makes
 * this launcher safe to run while other CLI sessions hold the canonical
 * :1420 / :17320 / :9420 ports — we shift every port and point at a throwaway
 * data dir, so nothing touches the real app-data dir or the shared shell.
 *
 * What it does NOT isolate: the WebView2 user-data folder (localStorage),
 * which is where guided-tour progress + the onboarding-completed flag live.
 * That seam is closed at the spec layer by `bootstrapFreshUser()` in
 * tests/playwright/companion-bridge.ts (finishOnboarding + reset all tours).
 *
 * Usage (library)
 * ---------------
 *   import { launchIsolated } from './launch-isolated.mjs';
 *   const inst = await launchIsolated();        // boots, waits for /health
 *   process.env.COMPANION_TEST_PORT = String(inst.port);
 *   // ... run specs ...
 *   await inst.stop();                           // kills tree + rm data dir
 *
 * Usage (CLI — boot, print port, stay up until Ctrl-C)
 * ----------------------------------------------------
 *   node scripts/test/launch-isolated.mjs
 *   node scripts/test/launch-isolated.mjs --test-port 17340 --keep-data
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Defaults shifted clear of the canonical dev ports (1420 / 17320 / 9420). */
export const DEFAULTS = Object.freeze({
  vitePort: 1430,
  testPort: 17330,
  webhookPort: 9430,
  /** Cold cargo compile of the lite+test profile can take 3–5 min. */
  timeoutMs: 360_000,
});

/** Number of consecutive test ports the Rust server may fall back across. */
const TEST_PORT_FALLBACK = 5;

const isWindows = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET /health on one port; resolves true only on `{status:"ok"}`. */
async function probeHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return body?.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Poll the requested port and its fallback range until one answers `ok`.
 * The Rust test-automation server tries `requested..requested+5` on
 * AddrInUse (test_automation.rs FALLBACK_PORT_ATTEMPTS), so the actual bound
 * port may differ from what we asked for.
 */
async function waitForBridge(requestedPort, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  const candidates = Array.from({ length: TEST_PORT_FALLBACK + 1 }, (_, i) => requestedPort + i);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`app process exited (code ${child.exitCode}) before the bridge came up`);
    }
    for (const port of candidates) {
      if (await probeHealth(port)) return port;
    }
    await sleep(1500);
  }
  throw new Error(
    `bridge did not become healthy within ${Math.round(timeoutMs / 1000)}s on ports ${candidates.join('/')}`,
  );
}

/** Kill the spawned dev process and its children (cargo + the app exe). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (isWindows) {
    // tauri dev spawns cargo, which spawns the app exe — SIGTERM to the npm
    // shim leaves orphans. taskkill /T walks the whole tree.
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* best-effort */
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
    }
  }
}

/**
 * Boot an isolated dev instance and resolve once its bridge answers /health.
 *
 * @param {object} [opts]
 * @param {string} [opts.dataDir]      Throwaway app-data dir. Default: a fresh mkdtemp.
 * @param {number} [opts.vitePort]
 * @param {number} [opts.testPort]
 * @param {number} [opts.webhookPort]
 * @param {number} [opts.timeoutMs]    How long to wait for the cold compile + boot.
 * @param {boolean}[opts.keepData]     Skip rm of dataDir on stop() (debugging).
 * @param {boolean}[opts.inheritStdio] Pipe the app's stdout/stderr to ours.
 * @returns {Promise<{port:number, dataDir:string, stop:()=>Promise<void>, child:import('node:child_process').ChildProcess}>}
 */
export async function launchIsolated(opts = {}) {
  const vitePort = opts.vitePort ?? DEFAULTS.vitePort;
  const testPort = opts.testPort ?? DEFAULTS.testPort;
  const webhookPort = opts.webhookPort ?? DEFAULTS.webhookPort;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const ownsDataDir = !opts.dataDir;
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'personas-tour-e2e-'));

  // Tauri's devUrl is hard-coded to localhost:1420 in tauri.conf.json. The
  // vite.config.ts comment says to pair PERSONAS_VITE_PORT with a
  // `--config build.devUrl` override; we write a tiny merge-config file
  // rather than fight Windows shell-quoting of inline JSON.
  const devUrlConfigPath = join(dataDir, 'devurl.config.json');
  writeFileSync(devUrlConfigPath, JSON.stringify({ build: { devUrl: `http://localhost:${vitePort}` } }));

  const env = {
    ...process.env,
    PERSONAS_DATA_DIR: dataDir,
    PERSONAS_VITE_PORT: String(vitePort),
    PERSONAS_TEST_PORT: String(testPort),
    PERSONAS_WEBHOOK_PORT: String(webhookPort),
  };

  // Mirror `tauri:dev:test` (lite profile + test-automation feature) but add
  // the devUrl override so the app connects to our shifted Vite port.
  const args = [
    'tauri', 'dev',
    '--config', 'src-tauri/tauri.lite.conf.json',
    '--config', devUrlConfigPath,
    '--', '--features', 'test-automation',
  ];

  const child = spawn('npx', args, {
    cwd: REPO_ROOT,
    env,
    stdio: opts.inheritStdio ? 'inherit' : 'ignore',
    shell: isWindows, // npx resolution on Windows needs the shell
    detached: !isWindows, // own process group so we can kill the tree on posix
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    killTree(child);
    // Give taskkill/SIGTERM a moment before removing the data dir so the DB
    // handle is released (Windows holds a lock on open files).
    await sleep(1500);
    if (ownsDataDir && !opts.keepData && existsSync(dataDir)) {
      try {
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch {
        /* a held file lock can defeat us; the OS temp sweep gets it later */
      }
    }
  };

  // Always clean up if the parent dies unexpectedly.
  const onExit = () => killTree(child);
  process.once('exit', onExit);
  process.once('SIGINT', async () => { await stop(); process.exit(130); });
  process.once('SIGTERM', async () => { await stop(); process.exit(143); });

  try {
    const port = await waitForBridge(testPort, timeoutMs, child);
    return { port, dataDir, stop, child };
  } catch (err) {
    await stop();
    throw err;
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────
function parseCliArgs(argv) {
  const out = { inheritStdio: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir') out.dataDir = argv[++i];
    else if (a === '--vite-port') out.vitePort = Number(argv[++i]);
    else if (a === '--test-port') out.testPort = Number(argv[++i]);
    else if (a === '--webhook-port') out.webhookPort = Number(argv[++i]);
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (a === '--keep-data') out.keepData = true;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('launch-isolated.mjs')) {
  const opts = parseCliArgs(process.argv.slice(2));
  console.log('[launch-isolated] booting isolated dev instance…');
  console.log(`[launch-isolated]   data dir : ${opts.dataDir ?? '(fresh temp dir)'}`);
  console.log(`[launch-isolated]   vite     : ${opts.vitePort ?? DEFAULTS.vitePort}`);
  console.log(`[launch-isolated]   test     : ${opts.testPort ?? DEFAULTS.testPort}`);
  console.log(`[launch-isolated]   webhook  : ${opts.webhookPort ?? DEFAULTS.webhookPort}`);
  launchIsolated(opts)
    .then((inst) => {
      console.log(`[launch-isolated] ✅ bridge healthy on :${inst.port}`);
      console.log(`[launch-isolated]    data dir: ${inst.dataDir}`);
      console.log('[launch-isolated] point specs at it with COMPANION_TEST_PORT=' + inst.port);
      console.log('[launch-isolated] Ctrl-C to stop and clean up.');
      // Keep the process alive; the SIGINT handler tears down.
    })
    .catch((err) => {
      console.error('[launch-isolated] ❌ ' + (err?.message ?? err));
      process.exit(1);
    });
}
