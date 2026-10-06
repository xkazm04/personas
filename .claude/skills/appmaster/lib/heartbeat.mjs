// The headless chair's state, told to the app: one best-effort POST per project through the
// dev-tools bridge (`POST /dev-tools/app-master/{project_id}/heartbeat`, the app's
// `commands/infrastructure/headless_master.rs`). While a beat is fresh the app shows the
// project's master as run from here and its in-app tick stands aside; `ended` hands it back.
// Design and numbers: docs/architecture/headless-app-master.md, "The state door".
//
// It is a NOTICE, never a dependency: `beat` never throws, gives up after BEAT_TIMEOUT_MS, and the
// app being down (no handshake file, a closed port, a build without the route) is an ordinary
// `{posted: false}`. It writes nothing locally and never touches the app database.

import { LIVE_RUN_STATES, shortId, slugify } from './contract.mjs';
import { listRuns, listSlugs, loadWakes } from './store.mjs';
import * as bridge from './bridge.mjs';

export const BEAT_TIMEOUT_MS = 2000;
export const BEAT_STATES = ['running', 'idle', 'ended'];
/** The app stores 600 characters of the note; sending more only costs the request. */
export const NOTE_SEND_MAX = 600;
/** Runs that mean "a builder is in flight or being verified" (planned has not started yet). */
const ACTIVE = LIVE_RUN_STATES.filter((s) => s !== 'planned');

/** The project id this skill last snapshotted for a slug (a wake's ProjectCtx, else a run's). */
export function projectIdOf(slug) {
  const fromWake = loadWakes(slug).filter((w) => w.project?.id).at(-1)?.project.id;
  if (fromWake) return fromWake;
  return listRuns(slug).filter((r) => r.project?.id).at(-1)?.project.id ?? null;
}

/**
 * (slug) => {state, note, nextWakeAt, runId}   derived from the journal only.
 * `running` while any run is running / exited / verifying, else `idle`; the next wake and the
 * note come from the latest decided wake; runId is the active run's short id.
 */
export function beatState(slug) {
  const active = listRuns(slug, { states: ACTIVE }).at(-1) ?? null;
  const decided = loadWakes(slug).filter((w) => w.status === 'decided').at(-1) ?? null;
  const note = String(decided?.note ?? '').trim();
  return {
    state: active ? 'running' : 'idle',
    note: note.length > NOTE_SEND_MAX ? note.slice(0, NOTE_SEND_MAX) : note,
    nextWakeAt: decided?.nextWakeAt ?? null,
    runId: active ? shortId(active.runId) : null,
  };
}

/**
 * (slug, projectId?, state?, {post?, timeoutMs?}) => Promise<{slug, posted, state?, reason?, suppressing?}>
 * Never throws. `projectId` and `state` default to what the journal says; `post` is the door
 * (tests pass a fake with bridge.devTools' signature).
 */
export async function beat(slug, projectId = null, state = null, { post, timeoutMs = BEAT_TIMEOUT_MS } = {}) {
  try {
    const pid = projectId || projectIdOf(slug);
    if (!pid) return { slug, posted: false, reason: 'no project id in the journal yet (run context first)' };
    const derived = beatState(slug);
    const body = { ...derived, state: state || derived.state };
    if (!BEAT_STATES.includes(body.state)) return { slug, posted: false, reason: `bad state ${body.state}` };
    for (const k of ['note', 'nextWakeAt', 'runId']) if (body[k] === null || body[k] === '') delete body[k];
    const send = post ?? ((route, b) => bridge.devTools(route, b, { timeoutMs }));
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ late: true }), timeoutMs + 250);
      timer.unref?.();
    });
    const res = await Promise.race([
      Promise.resolve().then(() => send(`/app-master/${encodeURIComponent(pid)}/heartbeat`, body)),
      late,
    ]).finally(() => clearTimeout(timer));
    if (res && res.late === true) return { slug, posted: false, state: body.state, reason: `no answer within ${timeoutMs} ms` };
    return { slug, posted: true, state: body.state, suppressing: Boolean(res?.suppressing) };
  } catch (e) {
    return { slug, posted: false, reason: String(e?.message || e).split('\n')[0].slice(0, 200) };
  }
}

/**
 * The slugs a finished subcommand changed, so the CLI can beat for them. Never throws.
 * decide -> --project; watch -> its rows (or --project / every managed slug); dispatch, settle,
 * release -> the run's slug.
 */
export function slugsAfter(sub, args = {}, result = null) {
  try {
    const flags = args.flags ?? {};
    if (Array.isArray(result)) {
      const s = [...new Set(result.map((r) => r?.slug).filter(Boolean))];
      if (s.length) return s;
    } else if (result && typeof result === 'object') {
      // the run's own slug, plus every project a promote (alone, or after an await) started a run in
      const promoted = [...(Array.isArray(result.slugs) ? result.slugs : []), ...(Array.isArray(result.promoted?.slugs) ? result.promoted.slugs : [])];
      const s = [...new Set([typeof result.slug === 'string' ? result.slug : null, ...promoted].filter((x) => typeof x === 'string' && x))];
      if (s.length) return s;
    }
    if (flags.project && flags.project !== true) {
      const want = slugify(flags.project);
      const hit = listSlugs().find((s) => s === want);
      if (hit) return [hit];
    }
    return sub === 'watch' ? listSlugs() : [];
  } catch {
    return [];
  }
}

/** Beat every slug a subcommand touched, in parallel (one time budget, not one per project).
 *  Never throws; resolves to the per-slug outcomes. */
export async function beatAfter(sub, args, result, opts = {}) {
  return Promise.all(slugsAfter(sub, args, result).map((slug) => beat(slug, null, null, opts)));
}

/**
 * (args) => {beats:[...]}   `heartbeat [--project p] [--state running|idle|ended]`
 * Without --project it beats every managed project (what `end` does with --state ended).
 */
export async function cmdHeartbeat({ flags = {} } = {}) {
  const state = flags.state && flags.state !== true ? String(flags.state) : null;
  if (state && !BEAT_STATES.includes(state)) throw new Error(`--state must be one of ${BEAT_STATES.join('|')}`);
  const slugs = flags.project && flags.project !== true ? [slugify(flags.project)] : listSlugs();
  return { beats: await Promise.all(slugs.map((slug) => beat(slug, null, state))) };
}
