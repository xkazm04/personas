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

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const STATE_DIR = path.join(ROOT, '.claude', 'grande');
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
  fs.writeFileSync(APP_JSON, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), port: TEST_PORT, log: APP_LOG }, null, 2));
  log(`launched pid ${child.pid}; log ${APP_LOG}`);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (await healthy() && handshake()) { log(`up after ${Math.round((Date.now() - (deadline - HEALTH_TIMEOUT_MS)) / 1000)} s`); return; }
    if (!pidAlive(child.pid)) { log('the launcher exited before the app answered; read the log'); process.exit(1); }
  }
  log('boot timeout; the process is still running, read the log'); process.exit(1);
}

async function down() {
  const rec = recorded();
  if (!rec) { log('nothing recorded; refusing to stop an instance this script did not start'); return; }
  if (pidAlive(rec.pid)) {
    execSync(`taskkill /PID ${rec.pid} /T /F`, { stdio: 'ignore' });
    log(`stopped pid ${rec.pid} and its tree`);
  } else log(`pid ${rec.pid} already gone`);
  fs.rmSync(APP_JSON, { force: true });
  await sleep(1500);
  log(`test server now ${(await healthy()) ? 'STILL answering (another instance)' : 'down'}`);
}

if (mode === 'up') await up();
else if (mode === 'down') await down();
else await status();
