// `await`: the exit watcher that replaces the Director's polling cadence. Started with
// run_in_background right after a dispatch, it BLOCKS until the builder's pid is gone (a cheap
// process.kill(pid, 0) every AWAIT.pollSec, no LLM), then does exactly what `watch` does for that
// run (running -> exited, the limit mark) and then exactly what `settle` does (the same code path,
// so the one machine-wide gate slot, the memory wait and every refusal are settle's own). It prints
// ONE document: the settled run plus waitedSec. The CLI posts the state-door heartbeat after it.
//
// Safe several at once: settling takes the gate slot (lib/memory.mjs), so two awaits never run gates
// together. One await per run: runs/<id>/await.lock; a second await on the same run is refused,
// and `settle` refuses a run another process is awaiting. On timeout it reports and exits 0; it
// NEVER kills a worker (the operator's word only, through `release --kill`).

import { AWAIT, MEM, TIMEOUT_MIN, Refusal, shortId } from './contract.mjs';
import { listRuns, listSlugs, loadRun } from './store.mjs';
import { requireRun, pidAlive, watchRun, takeAwaitLock, releaseAwaitLock, awaitHolder } from './worker.mjs';
import { cmdSettle } from './merge.mjs';
import { promote } from './promote.mjs';

/** The states an await may start on: a builder still running, or one that exited unsettled. */
export const AWAITABLE = ['running', 'exited'];

// NOT unref'd: this timer is what keeps the process alive while it waits
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pollMs = () => Number(process.env.APPMASTER_AWAIT_POLL_MS) || AWAIT.pollSec * 1000;

function timeoutMinOf(flags) {
  const raw = flags['timeout-min'];
  if (raw === undefined) return TIMEOUT_MIN;
  const n = Number(raw);
  if (raw === true || !Number.isFinite(n) || n <= 0) throw new Error('--timeout-min must be a positive number of minutes');
  return n;
}

/** The candidate runs: --run (exactly one), or every awaitable run of --project. */
function candidates(flags) {
  const hasRun = flags.run && flags.run !== true;
  const hasProject = flags.project && flags.project !== true;
  if (hasRun === hasProject) throw new Error('await needs exactly one of --run <runId> or --project <p>');
  if (hasRun) {
    const run = requireRun(flags.run);
    if (!AWAITABLE.includes(run.state)) {
      throw new Refusal('not awaitable', { runId: run.runId, slug: run.slug, state: run.state, hint: `await takes a ${AWAITABLE.join(' or ')} run` });
    }
    return { slug: run.slug, runs: [run], mode: 'run' };
  }
  const want = String(flags.project).toLowerCase();
  const slug = listSlugs().find((s) => s === want);
  if (!slug) throw new Error(`no managed project "${flags.project}" (managed: ${listSlugs().join(', ') || 'none'})`);
  const runs = listRuns(slug, { states: AWAITABLE });
  if (!runs.length) throw new Refusal('nothing to await', { slug, hint: `no ${AWAITABLE.join(' or ')} run in ${slug}` });
  return { slug, runs, mode: 'project' };
}

/** The first candidate whose builder is done: already exited, or running with its pid gone. */
const finished = (runs) => runs.find((r) => r.state === 'exited' || (r.state === 'running' && !pidAlive(r.pid))) ?? null;

/**
 * (args, {sleep}) => Promise<Run & {waitedSec}> | {timedOut:true, ...}
 *   await --run <runId|short> [--timeout-min N]
 *   await --project <p> [--timeout-min N]    the first of that project's running/exited runs to finish
 * Refusals: `not awaitable` (a run not running/exited), `nothing to await`, `already awaited`, and
 * every refusal of settle (memory, gate busy, ...), each with slug, runId and waitedSec added.
 */
export async function cmdAwait({ flags = {} } = {}, { sleep = defaultSleep } = {}) {
  const timeoutMin = timeoutMinOf(flags);
  const { slug, runs, mode } = candidates(flags);
  const started = Date.now();
  const waitedSec = () => Math.round((Date.now() - started) / 1000);
  const expiresAt = new Date(started + (timeoutMin + MEM.gateWaitMaxMin + AWAIT.lockSlackMin) * 60000).toISOString();

  // one await per run: lock every candidate this process will watch; skip (project) or refuse (run)
  const locked = [];
  for (const r of runs) {
    if (takeAwaitLock(r, expiresAt)) locked.push(r);
    else if (mode === 'run') {
      throw new Refusal('already awaited', { runId: r.runId, slug, holder: awaitHolder(r), hint: 'one await per run; the other one will settle it' });
    }
  }
  if (!locked.length) throw new Refusal('already awaited', { slug, runIds: runs.map((r) => shortId(r.runId)), hint: 'every awaitable run of this project already has an await' });

  try {
    let watching = locked;
    for (;;) {
      // re-read: the operator may release a run while we wait; that is not ours to settle any more
      watching = watching.map((r) => loadRun(r.slug, r.runId)).filter(Boolean);
      const gone = watching.filter((r) => !AWAITABLE.includes(r.state));
      watching = watching.filter((r) => AWAITABLE.includes(r.state));
      if (!watching.length) {
        const r = gone.at(-1);
        throw new Refusal(mode === 'run' ? 'not awaitable' : 'nothing to await', {
          slug, runId: r?.runId ?? null, state: r?.state ?? null, waitedSec: waitedSec(),
          hint: 'the run left running/exited while awaited (released or settled elsewhere)',
        });
      }
      const done = finished(watching);
      if (done) return settleAfterExit(done, slug, waitedSec());   // the wait ends at the exit, not after the gates
      if (Date.now() - started >= timeoutMin * 60000) {
        return {
          timedOut: true, slug, waitedSec: waitedSec(), timeoutMin,
          runs: watching.map((r) => ({ runId: r.runId, runId8: shortId(r.runId), state: r.state, pid: r.pid ?? null, pidAlive: pidAlive(r.pid) })),
          note: 'the builder is still running; nothing was killed (only `release --kill`, on the operator\'s word)',
        };
      }
      await sleep(pollMs());
    }
  } finally {
    for (const r of locked) releaseAwaitLock(r);
  }
}

/**
 * What `watch` does for this run, then `settle` itself, then a `promote` pass: the settled run freed
 * its slot, so the queue's next run that fits starts at once. Its `awaitCommands` are in `promoted`
 * for the Director to start. Refusals carry slug, runId and waitedSec; a promote that fails is
 * reported in `promoted.error` and never changes the settle's own result.
 * waitedSec is the wait for the EXIT; the settle's own gate-slot wait is in its result or refusal.
 */
function settleAfterExit(run, slug, waitedSec) {
  watchRun(run);   // running -> exited and the limit mark, exactly as `watch` would
  let settled;
  try {
    settled = cmdSettle({ flags: { run: run.runId } });
  } catch (e) {
    if (e instanceof Refusal) throw new Refusal(e.reason, { ...e.extra, slug, runId: run.runId, waitedSec });
    throw e;
  }
  let promoted;
  try { promoted = promote(); } catch (e) { promoted = { error: e instanceof Refusal ? e.reason : String(e?.message || e).split('\n')[0] }; }
  return { ...settled, waitedSec, promoted };
}
