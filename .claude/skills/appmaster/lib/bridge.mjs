// The app's doors (WP1): the dev-tools bridge (local_http, token from ~/.personas/local-http.json)
// and the test-automation bridge's invokeCommand. handshake/devTools/invoke are copied from
// .claude/skills/master/master.mjs (~236-271), which cannot be imported (it probes ports and parses
// argv at import, Director decision D7).
//
// Everything is lazy: importing this file touches neither the network nor the handshake file. It
// never writes the app DB; every write it carries goes through a door the UI also uses.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './contract.mjs';

export const PROBE_TIMEOUT_MS = 1500;
export const handshakePath = () => process.env.APPMASTER_HANDSHAKE || path.join(os.homedir(), '.personas', 'local-http.json');

/** {base, token, pid} of the running app's dev-tools bridge; throws when the file is absent. */
export function handshake() {
  const h = JSON.parse(fs.readFileSync(handshakePath(), 'utf8'));
  return { base: `http://127.0.0.1:${h.port}/dev-tools`, token: h.token, pid: h.pid };
}

function pidAlive(pid) {
  if (!pid) return true;   // no pid recorded: let the probe decide
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * () => Promise<boolean>. True when the handshake file exists, its pid is alive, and the bridge
 * answers GET /dev-tools/workspaces within 1500 ms. A missing file answers false at once (no port
 * scan); a dead pid answers false without touching the network.
 */
export async function appUp() {
  let h; try { h = handshake(); } catch { return false; }
  if (!pidAlive(h.pid)) return false;
  try {
    const r = await fetch(`${h.base}/workspaces`, { headers: { 'X-Personas-Local-Token': h.token }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return r.ok;
  } catch { return false; }
}

/**
 * (route, body?, {timeoutMs?}) => Promise<any>   // POST when body is given, else GET; throws on a
 * non-2xx. `timeoutMs` aborts a request the app never answers (the heartbeat's budget).
 */
export async function devTools(route, body, { timeoutMs } = {}) {
  const h = handshake();
  const res = await fetch(h.base + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Personas-Local-Token': h.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${route} -> ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;   // a 404 is "the route is not built yet": the outbox keeps the entry queued
    throw err;
  }
  return json;
}

/**
 * The test-automation bridge base. It binds 17320 or the next free port when a stale listener holds
 * it (measured 2026-09-14), so unless PERSONAS_BASE is pinned the first port answering /health
 * within 17320..17325 wins. Probed only when a door actually needs it, never at import.
 */
async function testBridgeBase() {
  if (process.env.PERSONAS_BASE) return process.env.PERSONAS_BASE;
  const first = Number(process.env.PERSONAS_TEST_PORT || 17320);
  for (let port = first; port < first + 6; port++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (r.ok) return `http://127.0.0.1:${port}`;
    } catch { /* next port */ }
  }
  return null;
}

let bridgeMod = null;
async function bridge() {
  if (bridgeMod) return bridgeMod;
  const base = await testBridgeBase();
  if (!base) throw new Error('the test-automation bridge is not reachable on 17320..17325 (the app must run with `npm run tauri:dev:test`)');
  process.env.PERSONAS_BASE = base;   // scripts/test/bridge.mjs reads it at import
  bridgeMod = await import(pathToFileURL(path.join(REPO_ROOT, 'scripts', 'test', 'bridge.mjs')).href);
  return bridgeMod;
}

/**
 * (command, params) => Promise<any>. invokeCommand over the test bridge returns {big:n} for results
 * over 380 chars, so a caller verifies the effect in the database rather than trusting the echo.
 */
export async function invoke(command, params) {
  const b = await bridge();
  const r = await b.invoke(command, params);
  if (r && r.ok === false) throw new Error(`${command}: ${r.e}`);
  return r;
}
