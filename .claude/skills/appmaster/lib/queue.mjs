// The durable admission queue (the admission-queue doctrine: "later is a promise"; a held request is
// owed an execution or an explicit refusal). A dispatch refused for a slot (QUEUE_REASONS: global
// cap, project cap, repo lane, paths overlap, memory) is NOT dropped: it is appended here and held
// until `promote` (lib/promote.mjs) dispatches it, or `queue drop` refuses it explicitly by releasing
// the run with a reason. One global file, _queue.jsonl: append-only, the latest line per runId wins.
//
// Order: entries the operator pinned with `queue move` (a `position`) come first, lower first; the
// rest follow FIFO by `decidedAt` (when the wake that minted the run was decided), then by
// `enqueuedAt`. A planned run that was decided but never dispatched is NOT in the queue: only a
// dispatch that was tried and refused enqueues.
//
// The queue lock serialises dispatch and promote across processes: several `await`s promote at once,
// and without it two of them could start the same run twice, or both take the last free slot.
// This file writes only _queue.jsonl and the lock file; it never dispatches anything itself.

import fs from 'node:fs';
import path from 'node:path';
import { QUEUE_LOCK, queuePath, queueLockPath, appendJsonl, readJsonl, readJson, nowIso, shortId, Refusal, SELF_REPO } from './contract.mjs';
import { loadWake } from './store.mjs';

// ---------------------------------------------------------------- the journal

/** Every entry, latest line per runId merged over the earlier ones. */
export function loadQueue() {
  const m = new Map();
  for (const r of readJsonl(queuePath())) if (r?.runId) m.set(r.runId, { ...(m.get(r.runId) ?? {}), ...r });
  return [...m.values()];
}

const ms = (s) => { const v = Date.parse(s); return Number.isFinite(v) ? v : Infinity; };
const pos = (e) => (Number.isFinite(e.position) ? e.position : Infinity);

/** The queued entries in promotion order: pinned positions first, then FIFO by decidedAt. */
export function orderQueue(entries = loadQueue()) {
  return entries.filter((e) => e.state === 'queued').sort((a, b) => {
    if (pos(a) !== pos(b)) return pos(a) < pos(b) ? -1 : 1;
    if (ms(a.decidedAt) !== ms(b.decidedAt)) return ms(a.decidedAt) < ms(b.decidedAt) ? -1 : 1;
    if (ms(a.enqueuedAt) !== ms(b.enqueuedAt)) return ms(a.enqueuedAt) < ms(b.enqueuedAt) ? -1 : 1;
    return String(a.runId).localeCompare(String(b.runId));
  });
}

/** The queued entry for a run, or null. */
export const queuedEntry = (runId) => loadQueue().find((e) => e.runId === runId && e.state === 'queued') ?? null;
/** 1-based position of a queued run in promotion order, or null. */
export function positionOf(runId) {
  const i = orderQueue().findIndex((e) => e.runId === runId);
  return i < 0 ? null : i + 1;
}

/**
 * (run, reason) => {entry, position, length}
 * Hold a refused dispatch. Idempotent: a run already queued keeps its enqueuedAt and its pinned
 * position (only a changed reason appends a line). A run queued again after it left the queue gets a
 * fresh entry with no pinned position.
 */
export function enqueue(run, reason) {
  const current = loadQueue().find((e) => e.runId === run.runId) ?? null;
  if (current?.state === 'queued') {
    if (current.reason !== reason) appendJsonl(queuePath(), { runId: run.runId, reason, lastRefusedAt: nowIso() });
  } else {
    appendJsonl(queuePath(), {
      runId: run.runId, slug: run.slug, charterSlug: run.charterSlug, repo: run.repo ?? SELF_REPO, model: run.model ?? null,
      decidedAt: loadWake(run.slug, run.wakeId)?.decidedAt ?? run.createdAt, enqueuedAt: nowIso(), reason,
      state: 'queued', position: null,
    });
  }
  const order = orderQueue();
  const i = order.findIndex((e) => e.runId === run.runId);
  return { entry: order[i] ?? null, position: i + 1, length: order.length };
}

/** Record a run leaving (or staying in) the queue: state promoted | dropped | queued, plus fields. */
export function markQueue(runId, state, extra = {}) {
  appendJsonl(queuePath(), { runId, state, ...extra });
}

/** The ordered queue as a table: position, project, charter, model, repo, waited (min since enqueuedAt), reason. */
export function queueTable(nowMs = Date.now()) {
  return orderQueue().map((e, i) => ({
    position: i + 1, runId: e.runId, runId8: shortId(e.runId), slug: e.slug, charterSlug: e.charterSlug,
    model: e.model ?? null, repo: e.repo ?? SELF_REPO, reason: e.reason ?? null,
    decidedAt: e.decidedAt ?? null, enqueuedAt: e.enqueuedAt ?? null,
    waitedMin: Number.isFinite(Date.parse(e.enqueuedAt)) ? Math.max(0, Math.round((nowMs - Date.parse(e.enqueuedAt)) / 60000)) : null,
    pinned: Number.isFinite(e.position),
  }));
}

/**
 * (runId, to) => the new order. Puts a queued run at 1-based position `to` (clamped) and pins every
 * queued entry at its new place, so the operator's order holds; runs queued later follow, FIFO.
 */
export function moveInQueue(runId, to) {
  const order = orderQueue();
  const i = order.findIndex((e) => e.runId === runId);
  if (i < 0) throw new Refusal('not queued', { runId });
  const n = Math.min(Math.max(1, Math.trunc(to)), order.length);
  const [moved] = order.splice(i, 1);
  order.splice(n - 1, 0, moved);
  order.forEach((e, k) => {
    if (e.position !== k + 1 || e.runId === runId) appendJsonl(queuePath(), { runId: e.runId, position: k + 1, ...(e.runId === runId ? { movedAt: nowIso() } : {}) });
  });
  return orderQueue();
}

// ---------------------------------------------------------------- the lock (dispatch and promote)

let depth = 0;   // re-entrant within one process: promote dispatches under the lock it holds
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function tryLock(label) {
  const p = queueLockPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    const fd = fs.openSync(p, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, label, at: nowIso() }));
    fs.closeSync(fd);
    return true;
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const held = readJson(p, null);
  const ageMin = held?.at ? (Date.now() - Date.parse(held.at)) / 60000 : Infinity;
  // a dead holder, a stale lock, or our own pid outside any locked section: take it over next poll
  if (!held || !pidAlive(held.pid) || ageMin > QUEUE_LOCK.staleMin || held.pid === process.pid) {
    try { fs.rmSync(p, { force: true }); } catch { /* raced */ }
  }
  return false;
}
function unlock() {
  const held = readJson(queueLockPath(), null);
  if (held?.pid === process.pid) { try { fs.rmSync(queueLockPath(), { force: true }); } catch { /* gone */ } }
}

/** Run fn() holding the machine-wide queue lock (bounded wait, then Refusal 'queue busy'). */
export function withQueueLock(fn, { label = 'queue', waitMs = Number(process.env.APPMASTER_QUEUE_LOCK_WAIT_MS) || QUEUE_LOCK.waitMs } = {}) {
  if (depth > 0) return fn();
  const started = Date.now();
  while (!tryLock(label)) {
    if (Date.now() - started >= waitMs) throw new Refusal('queue busy', { holder: readJson(queueLockPath(), null), waitedMs: Date.now() - started });
    sleepSync(QUEUE_LOCK.pollMs);
  }
  depth++;
  try { return fn(); } finally { depth--; if (depth === 0) unlock(); }
}
