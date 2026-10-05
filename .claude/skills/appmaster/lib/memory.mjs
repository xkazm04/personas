// Memory admission for /appmaster. Replaces the machine-wide "used %" brake, which a sibling process
// could pin high for hours without this loop being the cause (2026-10-05: a 20 GB `next dev` held it
// at 92-96% while all three builders had finished, and verification stalled for ~1 h; later the
// harness itself reaped our background shells under the same pressure).
//
// What is decided here, and why each is not a percentage:
//   dispatch  needs FREE GB >= dispatchMinFreeGb + perBuilderReserveGb x (builders already running):
//             a new builder is a ~1-1.5 GB process that then spawns tsc/vitest; our own growth counts.
//   gates     need FREE GB >= gateMinFreeGb and run ONE AT A TIME machine-wide (a lock file), because
//             a typecheck (~2.6 GB) plus a test run is the real peak and parallel projects stack it.
//             A gate WAITS (polling, bounded) for headroom instead of refusing: finished work should
//             not sit unverified because a sibling is busy. Only after the wait does it refuse.
//   sampling  is the median of several samples, so one spike does not flip a decision.
// Nothing here kills a process. It can name who is using the memory so the operator can.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MEM, STATE_ROOT, Refusal, nowIso, readJson } from './contract.mjs';

const GB = 2 ** 30;
const round1 = (n) => Math.round(n * 10) / 10;
const defaultSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** APPMASTER_FAKE_FREE_GB overrides the machine's free memory (tests only). */
function fakeFree() {
  const f = process.env.APPMASTER_FAKE_FREE_GB;
  return f !== undefined && f !== '' && Number.isFinite(Number(f)) ? Number(f) : null;
}

/** Median of `samples` readings of free (available) physical memory, in GB. */
export function sampleFreeGb({ samples = MEM.samples, gapMs = MEM.sampleGapMs, sleep = defaultSleep } = {}) {
  const fake = fakeFree();
  if (fake !== null) return fake;
  const xs = [];
  for (let i = 0; i < samples; i++) {
    xs.push(os.freemem() / GB);
    if (i < samples - 1) sleep(gapMs);
  }
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

/** What a dispatch needs right now, given the builders already running. */
export const dispatchNeedGb = (runningBuilders = 0) => MEM.dispatchMinFreeGb + MEM.perBuilderReserveGb * runningBuilders;

/**
 * {freeGb, totalGb, usedPct, dispatchNeedGb, gateNeedGb, dispatchOk, gateOk, stop}
 * `stop` is the dispatch brake (kept as the field every reader already uses). usedPct is for display only.
 */
export function memoryState({ runningBuilders = 0, free } = {}) {
  const freeGb = free ?? sampleFreeGb();
  const totalGb = fakeFree() !== null ? Math.max(freeGb, 64) : os.totalmem() / GB;
  const need = dispatchNeedGb(runningBuilders);
  const dispatchOk = freeGb >= need;
  return {
    freeGb: round1(freeGb), totalGb: round1(totalGb), usedPct: Math.round(((totalGb - freeGb) / totalGb) * 100),
    dispatchNeedGb: round1(need), gateNeedGb: MEM.gateMinFreeGb,
    dispatchOk, gateOk: freeGb >= MEM.gateMinFreeGb, stop: !dispatchOk,
  };
}

// ---------------------------------------------------------------- who is using it (diagnosis only)

/**
 * {ownGb, others:[{name, gb, cmd}]} or null off Windows / on error. "Ours" = the process trees of the
 * builders we run (run pids) plus any process whose command line sits under headless-masters (gates).
 */
export function pressureReport(ownRootPids = [], { top = 3 } = {}) {
  if (process.platform !== 'win32') return null;
  let rows;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine | ConvertTo-Json -Compress"],
    { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 64 * 2 ** 20 });
    rows = JSON.parse(out);
    if (!Array.isArray(rows)) rows = [rows];
  } catch { return null; }
  const byPid = new Map(rows.map((r) => [r.ProcessId, r]));
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ParentProcessId)) kids.set(r.ParentProcessId, []); kids.get(r.ParentProcessId).push(r.ProcessId); }
  const ours = new Set();
  const walk = (pid) => { if (ours.has(pid) || !byPid.has(pid)) return; ours.add(pid); for (const k of kids.get(pid) ?? []) walk(k); };
  for (const pid of ownRootPids) walk(pid);
  for (const r of rows) if (/headless-masters/i.test(r.CommandLine || '') && !/Get-CimInstance/.test(r.CommandLine || '')) walk(r.ProcessId);
  let own = 0; const others = new Map();
  for (const r of rows) {
    const ws = Number(r.WorkingSetSize) || 0;
    if (ours.has(r.ProcessId)) { own += ws; continue; }
    const cmd = String(r.CommandLine || '').replace(/\s+/g, ' ');
    const key = `${r.Name}:${r.ProcessId}`;
    others.set(key, { name: r.Name, pid: r.ProcessId, gb: ws / GB, cmd: cmd.length > 110 ? `${cmd.slice(0, 107)}...` : cmd });
  }
  return {
    ownGb: round1(own / GB),
    others: [...others.values()].sort((a, b) => b.gb - a.gb).slice(0, top).map((o) => ({ ...o, gb: round1(o.gb) })),
  };
}

// ---------------------------------------------------------------- the gate slot: one gate at a time

export const gateLockPath = () => path.join(STATE_ROOT, '_headless-gate.lock');
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function tryTakeLock(label) {
  const p = gateLockPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    const fd = fs.openSync(p, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, label, at: nowIso() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const held = readJson(p, null);
  const age = held?.at ? (Date.now() - Date.parse(held.at)) / 60000 : Infinity;
  if (!held || !pidAlive(held.pid) || age > MEM.lockStaleMin) { try { fs.rmSync(p, { force: true }); } catch { /* raced */ } }
  return false;
}
const releaseLock = () => {
  const held = readJson(gateLockPath(), null);
  if (held?.pid === process.pid) { try { fs.rmSync(gateLockPath(), { force: true }); } catch { /* gone */ } }
};

/**
 * Wait for the machine-wide gate slot AND for gateMinFreeGb, bounded. Returns a release() function.
 * Throws Refusal('gate busy') or Refusal('memory') once maxWaitMs passes; a Refusal leaves everything as it was.
 * Tests inject `sleep` and override the waits with APPMASTER_GATE_WAIT_MS / APPMASTER_GATE_POLL_MS.
 */
export function acquireGateSlot({ label = 'settle', sleep = defaultSleep, onWait } = {}) {
  const maxMs = Number(process.env.APPMASTER_GATE_WAIT_MS) || MEM.gateWaitMaxMin * 60000;
  const pollMs = Number(process.env.APPMASTER_GATE_POLL_MS) || MEM.gateWaitPollSec * 1000;
  const started = Date.now();
  const waited = () => Math.round((Date.now() - started) / 6000) / 10;
  while (!tryTakeLock(label)) {
    if (Date.now() - started >= maxMs) throw new Refusal('gate busy', { waitedMin: waited(), holder: readJson(gateLockPath(), null) });
    onWait?.('gate busy'); sleep(pollMs);
  }
  for (;;) {
    const free = sampleFreeGb({ sleep });
    if (free >= MEM.gateMinFreeGb) break;
    if (Date.now() - started >= maxMs) {
      releaseLock();
      throw new Refusal('memory', { freeGb: round1(free), needGb: MEM.gateMinFreeGb, waitedMin: waited(), for: 'a gate run' });
    }
    onWait?.('memory'); sleep(pollMs);
  }
  return releaseLock;
}
