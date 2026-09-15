#!/usr/bin/env node
// The Grand Simulation's app lifecycle, owned by the orchestrating session (the /grande skill).
//
//   node scripts/e2e/sim-app.mjs up       # reuse a healthy instance, else launch tauri:dev:test
//   node scripts/e2e/sim-app.mjs status   # health, handshake, recorded pid
//   node scripts/e2e/sim-app.mjs down     # stop ONLY the instance this script launched
//
// `up` launches `npm run tauri:dev:test` detached with the simulation's environment
// (PERSONAS_HEADLESS_BRIDGE=1 so kp hires execute without a click; KP_AUTOMATION_TOKEN passed
// through when the shell has it, warned about when it does not), logs to .claude/grande/app.log,
// and records the pid in .claude/grande/app.json. It never kills an instance it did not start:
// a healthy app on the test port is reused, and only an orphaned Vite on :1420 with NO healthy
// app behind it is stopped, by its own pid (the documented recurring case).
//
// THE APP RUNS FROM ITS OWN WORKTREE (operator decision 2026-09-15). `SIM_APP_ROOT` names the
// checkout `tauri dev` watches — by default `.claude/worktrees/sim-app` on branch `sim-app`,
// created once with `git worktree add .claude/worktrees/sim-app -b sim-app master` and
// `npm ci` inside it. Every merge into the main checkout used to rebuild the running app and
// kill every headless worker mid tool call (ten relaunches on 2026-09-14). `up` fast-forwards
// the worktree's branch to `master` before launching, so a relaunch is a deliberate act of
// the orchestrator between wakes and never a side effect of a sibling's merge. State
// (`app.json`, `app.log`) stays under the MAIN checkout's `.claude/grande/`.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAIN_ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DEFAULT_APP_ROOT = path.join(MAIN_ROOT, '.claude', 'worktrees', 'sim-app');
const ROOT = process.env.SIM_APP_ROOT
  ? path.resolve(process.env.SIM_APP_ROOT)
  : (fs.existsSync(path.join(DEFAULT_APP_ROOT, 'package.json')) ? DEFAULT_APP_ROOT : MAIN_ROOT);
const STATE_DIR = path.join(MAIN_ROOT, '.claude', 'grande');
const APP_JSON = path.join(STATE_DIR, 'app.json');
const APP_LOG = path.join(STATE_DIR, 'app.log');
const TEST_PORT = Number(process.env.PERSONAS_TEST_PORT || 17320);
const HANDSHAKE = path.join(os.homedir(), '.personas', 'local-http.json');
const HEALTH_TIMEOUT_MS = Number(process.env.SIM_APP_BOOT_TIMEOUT_MS || 15 * 60 * 1000);

const mode = process.argv[2] || 'status';
const log = (m) => console.log(`[sim-app] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy() {
  try {
    const r = await fetch(`http://127.0.0.1:${TEST_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
function handshake() {
  try { return JSON.parse(fs.readFileSync(HANDSHAKE, 'utf8')); } catch { return null; }
}
function recorded() {
  try { return JSON.parse(fs.readFileSync(APP_JSON, 'utf8')); } catch { return null; }
}
function pidAlive(pid) {
  try { return execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' }).includes(String(pid)); } catch { return false; }
}
function listenerPid(port) {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const line = out.split(/\r?\n/).find((l) => l.includes(`:${port} `) && l.includes('LISTENING'));
    return line ? Number(line.trim().split(/\s+/).pop()) : null;
  } catch { return null; }
}

async function status() {
  const h = await healthy();
  const hs = handshake();
  const rec = recorded();
  log(`test server :${TEST_PORT}: ${h ? `healthy (${h.server} ${h.version})` : 'not answering'}`);
  log(`dev-tools handshake: ${hs ? `port ${hs.port}` : 'absent'}`);
  log(`recorded instance: ${rec ? `pid ${rec.pid} started ${rec.startedAt}, ${pidAlive(rec.pid) ? 'alive' : 'gone'}` : 'none'}`);
  log(`app checkout: ${ROOT}${ROOT === MAIN_ROOT ? ' (the MAIN checkout — sibling merges will relaunch the app; create .claude/worktrees/sim-app)' : ''}`);
  return { healthy: Boolean(h), handshake: Boolean(hs), rec };
}

async function up() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const s = await status();
  if (s.healthy && s.handshake) { log('reusing the running instance'); return; }
  const vite = listenerPid(1420);
  if (vite && !s.healthy) {
    // A previous tauri dev failed mid-startup and left Vite behind; the app is not there.
    log(`orphaned Vite on :1420 (pid ${vite}), stopping that pid only`);
    try { execSync(`taskkill /PID ${vite} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
    await sleep(1500);
  }
  // Cargo caches its `rustc -vV` probe in `<target>/.rustc_info.json`, and a
  // dev run killed mid-flight can leave that file corrupt. Every later cargo
  // invocation in that target then dies with
  // `rustc.exe -vV (exit code: 0xc0000142, STATUS_DLL_INIT_FAILED)` while the
  // same rustc runs perfectly by hand, so the failure reads as a broken
  // toolchain and costs hours. Measured 2026-09-08: five consecutive failures
  // in the shared target, a fresh target dir green, and one `rm` of this file
  // green again. Deleting it costs one re-probe; keeping a bad one costs the
  // whole session.
  try {
    const probe = path.join(ROOT, 'src-tauri', 'target', '.rustc_info.json');
    if (fs.existsSync(probe)) { fs.rmSync(probe, { force: true }); log('cleared the cached rustc probe (a killed dev run can corrupt it)'); }
  } catch { /* best effort: a probe we cannot remove is not a reason to refuse to launch */ }
  // A dedicated checkout is brought to master's tip before it is built, so the app
  // always runs what was merged and the merge itself never touched it. Fast-forward
  // only: the sim-app branch carries nothing of its own, and a refusal here means a
  // sibling committed on it, which the orchestrator wants to see rather than merge over.
  if (ROOT !== MAIN_ROOT) {
    try {
      const before = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
      execSync('git merge --ff-only master', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const after = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
      log(`app checkout ${ROOT} at ${after}${before !== after ? ` (fast-forwarded from ${before})` : ''}`);
    } catch (e) {
      const first = String(e.stderr || e.message).trim().split(String.fromCharCode(10))[0].trim();
      log(`could not fast-forward the app checkout to master: ${first}; launching what is there`);
    }
  }
  const env = { ...process.env, PERSONAS_HEADLESS_BRIDGE: '1' };
  // The shared secret lives outside every repository, in ~/.personas/grande.env.json, and the
  // same value goes into kp's .env.local; the shell wins when it carries one.
  if (!env.KP_AUTOMATION_TOKEN) {
    try { env.KP_AUTOMATION_TOKEN = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.personas', 'grande.env.json'), 'utf8')).KP_AUTOMATION_TOKEN; } catch { /* absent: hires refuse, and the line below says so */ }
  }
  if (!env.KP_AUTOMATION_TOKEN) log('KP_AUTOMATION_TOKEN is set neither in this shell nor in ~/.personas/grande.env.json: outbound hires will be refused until it is');
  else log('KP_AUTOMATION_TOKEN present for the app process');
  const out = fs.openSync(APP_LOG, 'a');
  fs.writeSync(out, `\n===== launch ${new Date().toISOString()} =====\n`);
  const child = spawn('cmd.exe', ['/c', 'npm run tauri:dev:test'], {
    cwd: ROOT, env, detached: true, stdio: ['ignore', out, out], windowsHide: true,
  });
  child.unref();
  fs.writeFileSync(APP_JSON, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), port: TEST_PORT, log: APP_LOG, root: ROOT }, null, 2));
  log(`launched pid ${child.pid}; log ${APP_LOG}`);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (await healthy() && handshake()) {
      // Record the LISTENER, not just the launcher: measured 2026-09-08, the
      // `cmd /c npm run` wrapper exits during the cargo build while the app it
      // started runs on, so a later `status` reads "gone" for a healthy app and
      // `down` kills nothing. The launcher pid is kept for the log's sake.
      const app = listenerPid(TEST_PORT);
      fs.writeFileSync(APP_JSON, JSON.stringify({ pid: app ?? child.pid, launcherPid: child.pid, startedAt: new Date().toISOString(), port: TEST_PORT, log: APP_LOG, root: ROOT }, null, 2));
      log(`up after ${Math.round((Date.now() - (deadline - HEALTH_TIMEOUT_MS)) / 1000)} s; app pid ${app ?? child.pid}`);
      return;
    }
    // The launcher exiting is only fatal while nothing of the build is alive:
    // Vite holds :1420 long before the app answers on the test port.
    if (!pidAlive(child.pid) && !listenerPid(1420) && !listenerPid(TEST_PORT)) { log('the launcher exited and nothing is listening; read the log'); process.exit(1); }
  }
  log('boot timeout; the process is still running, read the log'); process.exit(1);
}

async function down() {
  const rec = recorded();
  const killed = [];
  const kill = (pid, what) => { if (!pid || killed.includes(pid)) return; try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); killed.push(pid); log(`stopped ${what} pid ${pid} and its tree`); } catch { log(`${what} pid ${pid} already gone`); } };
  if (!rec && !(await healthy())) { log('nothing recorded and nothing answering; nothing to stop'); return; }
  // The LAUNCHER first, and this order is the whole lesson: `tauri dev` supervises
  // the app binary, so killing the binary alone makes it rebuild and come back,
  // and the next `up` then dies on Vite's port with an empty log. Measured
  // 2026-09-08 when a restart-after-merge looked like a launch failure.
  if (rec?.launcherPid && pidAlive(rec.launcherPid)) kill(rec.launcherPid, 'launcher');
  if (rec && pidAlive(rec.pid)) kill(rec.pid, 'recorded');
  // Then whatever still holds the ports, in case the chain outlived its root.
  if (await healthy()) kill(listenerPid(TEST_PORT), 'test-server listener');
  kill(listenerPid(1420), 'vite');
  fs.rmSync(APP_JSON, { force: true });
  await sleep(1500);
  log(`test server now ${(await healthy()) ? 'STILL answering (another instance)' : 'down'}`);
}

if (mode === 'up') await up();
else if (mode === 'down') await down();
else await status();
