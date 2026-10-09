// Keeping the queue's promise: `promote` dispatches, in queue order, every queued run that now fits
// the caps, the repo lanes, the paths and the memory; `queue list|move|drop` show, reorder and
// explicitly refuse. `await` runs a promote after it settles, so a freed slot is refilled at once.
//
// A promote pass holds the queue lock for its whole walk (lib/queue.mjs), so two awaits finishing
// together cannot start the same run twice. It skips a run that does not fit (another project's
// run behind it may), and stops at a refusal that binds every run (global cap, memory, usage limit).

import { QUEUE_REASONS, Refusal, nowIso, shortId } from './contract.mjs';
import { findRun } from './store.mjs';
import { loadQueue, orderQueue, markQueue, moveInQueue, queueTable, queuedEntry, withQueueLock } from './queue.mjs';
import { dispatchCore, awaitCommandFor, cmdRelease, requireRun } from './worker.mjs';

/** A refusal that no later run in the queue could get past either. */
export const STOP_REASONS = ['global cap', 'memory', 'usage limit'];

/**
 * () => {promoted:[runId], stillQueued:n, refusals:[{runId,reason}], awaitCommands:[{runId,runId8,slug,awaitCommand}], slugs:[]}
 * Every queued run is accounted for: promoted, or in refusals with the reason it still waits (or why
 * it left the queue: a run that is no longer planned is dropped, one already running is promoted).
 */
export function promote() {
  return withQueueLock(() => {
    const out = { promoted: [], stillQueued: 0, refusals: [], awaitCommands: [], slugs: [] };
    let stop = null;
    for (const e of orderQueue(loadQueue())) {
      const run = findRun(e.runId);
      if (!run) {
        markQueue(e.runId, 'dropped', { droppedAt: nowIso(), droppedReason: 'the run is in no managed project' });
        out.refusals.push({ runId: e.runId, reason: 'run not found (dropped from the queue)' });
        continue;
      }
      if (run.state === 'running') { markQueue(e.runId, 'promoted', { promotedAt: nowIso(), note: 'already running' }); continue; }
      if (run.state !== 'planned') {
        markQueue(e.runId, 'dropped', { droppedAt: nowIso(), droppedReason: `the run is ${run.state}` });
        out.refusals.push({ runId: e.runId, reason: `run is ${run.state} (dropped from the queue)` });
        continue;
      }
      if (stop) { out.stillQueued++; out.refusals.push({ runId: e.runId, reason: stop }); continue; }
      try {
        const r = dispatchCore({ flags: { run: run.runId } });
        markQueue(e.runId, 'promoted', { promotedAt: nowIso() });
        out.promoted.push(r.runId);
        out.awaitCommands.push({ runId: r.runId, runId8: shortId(r.runId), slug: r.slug, awaitCommand: awaitCommandFor(r) });
        if (!out.slugs.includes(r.slug)) out.slugs.push(r.slug);
      } catch (err) {
        out.stillQueued++;
        const reason = err instanceof Refusal ? err.reason : `error: ${String(err?.message || err).split('\n')[0].slice(0, 200)}`;
        out.refusals.push({ runId: e.runId, reason });
        if (err instanceof Refusal && QUEUE_REASONS.includes(reason) && reason !== e.reason) markQueue(e.runId, 'queued', { reason, lastRefusedAt: nowIso() });
        if (STOP_REASONS.includes(reason)) stop = reason;
      }
    }
    return out;
  }, { label: 'promote' });
}

/** (args) => promote()'s result */
export function cmdPromote() { return promote(); }

const posInt = (v) => { const n = Number(v); return v !== true && Number.isInteger(n) && n >= 1 ? n : null; };

/**
 * (args) => list | move | drop
 *   queue list                              {length, queue:[{position, slug, charterSlug, model, repo, waitedMin, reason, ...}]}
 *   queue move --run <id> --to <n>          pins the run at position n (1 = next to promote)
 *   queue drop --run <id> --reason <text>   the explicit refusal: releases the run with the reason
 */
export function cmdQueue({ _ = [], flags = {} } = {}) {
  const sub = _[0] ?? 'list';
  if (sub === 'list') { const queue = queueTable(); return { length: queue.length, queue }; }
  if (sub === 'move') {
    const run = requireRun(flags.run);
    const to = posInt(flags.to);
    if (!to) throw new Error('queue move needs --to <position>, a positive integer');
    return withQueueLock(() => {
      if (!queuedEntry(run.runId)) throw new Refusal('not queued', { runId: run.runId, slug: run.slug, state: run.state });
      moveInQueue(run.runId, to);
      const queue = queueTable();
      return { moved: run.runId, runId8: shortId(run.runId), to: queue.find((r) => r.runId === run.runId)?.position ?? null, length: queue.length, queue };
    }, { label: 'queue move' });
  }
  if (sub === 'drop') {
    const run = requireRun(flags.run);
    if (!flags.reason || flags.reason === true) throw new Error('queue drop needs --reason <text>');
    return withQueueLock(() => {
      if (!queuedEntry(run.runId)) throw new Refusal('not queued', { runId: run.runId, slug: run.slug, state: run.state });
      const released = cmdRelease({ flags: { run: run.runId, reason: String(flags.reason) } });
      const queue = queueTable();
      return { dropped: run.runId, runId8: shortId(run.runId), slug: run.slug, reason: String(flags.reason), run: released, length: queue.length, queue };
    }, { label: 'queue drop' });
  }
  throw new Error(`queue: unknown subcommand ${sub} (list|move|drop)`);
}
