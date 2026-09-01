#!/usr/bin/env node
/**
 * load-harness — drive the synthetic load ramp and record what each level costs.
 *
 * THE QUESTION THIS EXISTS TO ANSWER: does the Monitor's React implementation
 * hold up under the regime the app is being built toward — hundreds of sessions,
 * terminals streaming continuously, state flipping constantly — or does it need
 * a different renderer (a Leptos/WASM island, a canvas surface, a native UI)?
 *
 * Nobody should answer that from intuition, and the first measurement taken on
 * this surface could not answer it either: it was recorded at idle, with seven
 * personas and no traffic, and it said React was free. That is the floor, not
 * the ceiling, and the ceiling is the only number that decides anything.
 *
 * ## How to use it
 *
 *   node scripts/perf/load-harness.mjs --label react
 *   node scripts/perf/load-harness.mjs --label leptos --hold 45
 *   node scripts/perf/load-harness.mjs --ramp chatter --label react-poll-path
 *
 * `--label` is the important flag: it is what makes two runs comparable. Run the
 * same ramp against each renderer and diff the tables.
 *
 * ## What it requires
 *
 * The app running with `npm run tauri:dev:test` (the test-automation bridge on
 * :17320), and THE SURFACE UNDER TEST ON SCREEN. A load run against a closed
 * Monitor measures an idle app very thoroughly. The runner checks for the
 * Monitor and opens it rather than silently producing a meaningless table.
 *
 * ## How to read the output
 *
 * Four columns decide it, and they are deliberately not "average render time":
 *
 *   emitted vs recv  — if received falls behind emitted, the TRANSPORT
 *                      saturated, not the renderer. Every number to the right
 *                      of that point understates the load and must be thrown
 *                      away. This is the check that keeps a run honest.
 *   blocked%         — share of wall clock the main thread spent inside tasks
 *                      over 50ms. This is jank. Over ~10% the UI feels broken
 *                      regardless of what the average commit time says.
 *   p95 frame        — the tail the user actually perceives. An app can hold a
 *                      1ms average commit and still drop every third frame.
 *   heap Δ           — growth across the step. Steady growth at a constant load
 *                      is a leak, and a leak is the failure mode that only ever
 *                      shows up under sustained traffic.
 *
 * `commits` and `actual ms` are included but are the WEAKEST signals here: React
 * elides most render work via memoization, so they can stay flat while the
 * thread is blocked doing something else entirely.
 *
 * ## What the ramp loads, and what it still does not
 *
 * v2 closed the gap this header used to declare. The ramp now drives BOTH
 * halves of the Monitor's traffic:
 *   - PUSH: fleet terminal output, session state flips, and session CHURN
 *     (spawn/die), which unmounts a board node and forces a registry refetch.
 *   - POLL: channel chatter and pending reviews, spliced into
 *     `list_team_channel` and `list_manual_reviews` above SQLite. Those are the
 *     paths the operator's own peak is dominated by — "agents chatting and
 *     raising reviews" — and until v2 they carried no load at all.
 *
 * Two things are still NOT loaded, and both matter when reading a result:
 *   - PERSONA COUNT. Personas are database rows and the harness writes none, so
 *     the board's persona-tile count cannot be inflated. Scale `sessions` to the
 *     NODE COUNT you want instead: a session tile costs what a persona tile
 *     costs to lay out and paint. What this cannot measure is persona-specific
 *     state derivation.
 *   - THE DATABASE. The poll sources merge in above SQLite, so a run measures
 *     everything from the IPC boundary up and understates query cost. Right for
 *     a renderer question; wrong for a query one.
 */

// Runs land in `docs/harness/perf-runs/`, which is this repo's existing and
// TRACKED convention for perf records (17 committed already, from the Playwright
// nav-walk harness). Tracked is the right call here rather than a gitignored
// scratch dir: the whole point is to compare React against a second renderer,
// and to re-run the same ramp months later once the feature set has grown —
// neither is possible if each run only ever existed on one machine.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.PERSONAS_TEST_BASE || 'http://127.0.0.1:17320';

// ── Ramps ──────────────────────────────────────────────────────────────────
//
// Every step is a RATE held for `--hold` seconds. The ramp starts at zero on
// purpose: the first row is the control, and without it a run has nothing to
// attribute its own numbers against.
//
// `lines_per_sec` is the total across all sessions, so the per-session rate
// falls as the fleet grows — which is the realistic shape (one operator's
// twenty CLIs are not each producing a build log at full tilt).

const RAMPS = {
  // THE OPERATOR'S OWN PEAK, quoted from the brief and then made concrete:
  //
  //   "10-20 fleets spread across projects to spawn and die"
  //   "20 projects with 5 personas each (100 agents) ... max 40 agents active
  //    at one time, their output will be chat messages and reviews for triage
  //    which we expect user will read and react as they come"
  //
  // Translated into what the harness can actually drive:
  //   sessions            = BOARD NODES. 20 fleets + the 40 active agents the
  //                         board is painting = ~60 live nodes at peak. Persona
  //                         rows cannot be synthesised (see the header), so
  //                         sessions stand in for the node count.
  //   channelMsgsPerSec   = 40 active agents talking. At one remark per agent
  //                         per ~10s that is ~4/s; the last two steps push past
  //                         the stated peak deliberately, because the useful
  //                         number is where it BREAKS, not that it survives.
  //   reviewsPending      = the triage backlog the operator works down. A LEVEL,
  //                         not a rate.
  //   sessionChurnPerMin  = fleets finishing their task and being replaced.
  //   linesPerSec         = terminal output across whatever is live.
  peak: [
    { label: 'idle', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0, channelMsgsPerSec: 0, reviewsPending: 0, sessionChurnPerMin: 0 },
    { label: 'morning', sessions: 12, linesPerSec: 30, stateFlipsPerSec: 2, channelMsgsPerSec: 1, reviewsPending: 5, sessionChurnPerMin: 1 },
    { label: 'working', sessions: 30, linesPerSec: 90, stateFlipsPerSec: 5, channelMsgsPerSec: 2, reviewsPending: 20, sessionChurnPerMin: 3 },
    { label: 'peak', sessions: 60, linesPerSec: 200, stateFlipsPerSec: 12, channelMsgsPerSec: 4, reviewsPending: 60, sessionChurnPerMin: 6 },
    { label: 'over', sessions: 100, linesPerSec: 400, stateFlipsPerSec: 25, channelMsgsPerSec: 10, reviewsPending: 150, sessionChurnPerMin: 12 },
    { label: 'edge', sessions: 130, linesPerSec: 600, stateFlipsPerSec: 35, channelMsgsPerSec: 16, reviewsPending: 250, sessionChurnPerMin: 20 },
    { label: 'break', sessions: 160, linesPerSec: 900, stateFlipsPerSec: 50, channelMsgsPerSec: 25, reviewsPending: 400, sessionChurnPerMin: 30 },
  ],
  // The original event-only ramp, kept so a v1 run stays comparable to a v2 one.
  default: [
    { label: 'idle', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0 },
    { label: 'light', sessions: 8, linesPerSec: 20, stateFlipsPerSec: 1 },
    { label: 'working', sessions: 25, linesPerSec: 60, stateFlipsPerSec: 3 },
    { label: 'busy', sessions: 50, linesPerSec: 150, stateFlipsPerSec: 8 },
    { label: 'heavy', sessions: 100, linesPerSec: 400, stateFlipsPerSec: 20 },
    { label: 'extreme', sessions: 200, linesPerSec: 900, stateFlipsPerSec: 50 },
  ],
  // Isolate the POLL path: no fleet at all, only agents talking and raising
  // reviews. If the knee is here rather than in the ramp above, the problem is
  // the store/poll fan-out and not the board.
  chatter: [
    { label: 'idle', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0, channelMsgsPerSec: 0, reviewsPending: 0 },
    { label: 'c2', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0, channelMsgsPerSec: 2, reviewsPending: 20 },
    { label: 'c8', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0, channelMsgsPerSec: 8, reviewsPending: 80 },
    { label: 'c20', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0, channelMsgsPerSec: 20, reviewsPending: 200 },
    { label: 'c50', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0, channelMsgsPerSec: 50, reviewsPending: 500 },
  ],
  // A single long hold — the shape that exposes leaks and steady-state drift,
  // which a short ramp cannot see by construction.
  soak: [
    { label: 'idle', sessions: 0, linesPerSec: 0, stateFlipsPerSec: 0, channelMsgsPerSec: 0, reviewsPending: 0 },
    { label: 'soak-1', sessions: 60, linesPerSec: 200, stateFlipsPerSec: 12, channelMsgsPerSec: 4, reviewsPending: 60, sessionChurnPerMin: 6 },
    { label: 'soak-2', sessions: 60, linesPerSec: 200, stateFlipsPerSec: 12, channelMsgsPerSec: 4, reviewsPending: 60, sessionChurnPerMin: 6 },
    { label: 'soak-3', sessions: 60, linesPerSec: 200, stateFlipsPerSec: 12, channelMsgsPerSec: 4, reviewsPending: 60, sessionChurnPerMin: 6 },
    { label: 'soak-4', sessions: 60, linesPerSec: 200, stateFlipsPerSec: 12, channelMsgsPerSec: 4, reviewsPending: 60, sessionChurnPerMin: 6 },
  ],
};

// ── args ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { label: 'unlabelled', ramp: 'peak', hold: 30, out: 'docs/harness/perf-runs', open: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--label') out.label = argv[++i];
    else if (a === '--ramp') out.ramp = argv[++i];
    else if (a === '--hold') out.hold = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--no-open') out.open = false;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const USAGE = `
load-harness — synthetic load ramp for the Monitor

  --label <name>   Name this run so it can be compared to another renderer's.
  --ramp  <name>   peak | default | chatter | soak   (default: peak)
  --hold  <sec>    Seconds to hold each step   (default: 30)
  --out   <dir>    Where the JSON lands  (default: docs/harness/perf-runs)
  --no-open        Do not auto-open the Monitor; measure whatever is on screen.

Requires the app running with: npm run tauri:dev:test
`;

// ── bridge ─────────────────────────────────────────────────────────────────

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function get(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable() {
  try {
    const r = await fetch(BASE + '/health');
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Put the surface under test on screen.
 *
 * A run against a closed Monitor is not a weaker measurement, it is a
 * measurement of something else — so this is a precondition, not a convenience.
 */
/**
 * Real persona ids from the app's own state.
 *
 * Handed to the generator so synthetic chatter and reviews attach to personas
 * that actually exist — which is what makes them render with a name, a colour
 * and an avatar instead of as anonymous rows. An anonymous row still loads the
 * same code paths, but it paints a cheaper one, and the whole question here is
 * what painting costs.
 */
async function personaIds() {
  try {
    const state = await get('/state');
    const ids = (state.personas ?? []).map((p) => p.id).filter(Boolean);
    return ids;
  } catch {
    return [];
  }
}

async function ensureMonitorOpen() {
  const found = await post('/query', { selector: '[data-testid="persona-monitor"]' });
  if (Array.isArray(found) && found.length > 0) return true;
  await post('/click-testid', { test_id: 'titlebar-process-activity' });
  await sleep(2500);
  const again = await post('/query', { selector: '[data-testid="persona-monitor"]' });
  return Array.isArray(again) && again.length > 0;
}

// ── formatting ─────────────────────────────────────────────────────────────

const mb = (bytes) => (bytes == null ? 0 : Math.round((bytes / 1048576) * 10) / 10);
const pad = (v, n) => String(v).padStart(n);

function renderTable(rows) {
  const head = [
    ['step', 9], ['sess', 5], ['ln/s', 5], ['msg/s', 6], ['churn', 6],
    ['emitted', 8], ['recv', 8], ['servedCh', 9], ['servedRv', 9],
    ['commits', 8], ['actual ms', 10], ['blocked%', 9],
    ['p95 fr', 7], ['>50ms', 6], ['heap MB', 8], ['ipc', 5],
  ];
  const line = head.map(([h, w]) => pad(h, w)).join(' ');
  const sep = head.map(([, w]) => '─'.repeat(w)).join('─');
  const body = rows.map((r) => [
    pad(r.unresponsive ? `${r.label}!` : r.label, 9), pad(r.sessions, 5), pad(r.linesPerSec, 5),
    pad(r.msgs, 6), pad(r.churned, 6),
    pad(r.emitted, 8), pad(r.received, 8),
    pad(r.servedChannel, 9), pad(r.servedReviews, 9),
    pad(r.commits, 8), pad(r.actualMs.toFixed(0), 10),
    pad(r.blockedPct.toFixed(1), 9),
    pad(r.p95Frame.toFixed(1), 7), pad(r.framesOver50, 6),
    pad(r.heapMb.toFixed(1), 8),
    pad(r.ipcCalls, 5),
  ].join(' '));
  return [line, sep, ...body].join('\n');
}

/**
 * The reading, stated rather than left to the eye.
 *
 * Transport saturation is checked FIRST and reported loudest, because it
 * invalidates every renderer number in the same row — a renderer cannot be
 * blamed for load it never received.
 */
function verdict(rows) {
  const notes = [];

  // VALIDITY FIRST. Everything below is a statement about the renderer, and a
  // statement about the renderer is worthless if the generator did not deliver
  // the load the row is labelled with. These checks come before any reading of
  // the numbers, and they are phrased as "discard", not as "note".
  const dead = rows.find((r) => !r.driverAlive && r.emitted > 0);
  if (dead) {
    notes.push(
      `GENERATOR DEAD at "${dead.label}": the driver task was not alive at the end of the step. ` +
      `The load stopped without the rates changing, so every step from here reads as a fast ` +
      `renderer when it is really an absent workload. DISCARD this run.`,
    );
  }
  const panicked = rows.find((r) => r.tickPanics > 0);
  if (panicked) {
    notes.push(
      `GENERATOR PANICKED at "${panicked.label}" (${panicked.tickPanics} tick(s) caught). Those ` +
      `cycles emitted nothing and the harness cannot say how much load was skipped. DISCARD this run.`,
    );
  }
  const emitFailed = rows.find((r) => r.emitErrors > 0);
  if (emitFailed) {
    notes.push(
      `EMIT FAILURES at "${emitFailed.label}" (${emitFailed.emitErrors}). The transport refused ` +
      `traffic the harness counted as sent, so "emitted" overstates the real load.`,
    );
  }
  const wedged = rows.find((r) => r.emitted > 0 && r.sinceLastTickMs > 1000);
  if (wedged) {
    notes.push(
      `GENERATOR STALLED at "${wedged.label}": ${wedged.sinceLastTickMs}ms since the last completed ` +
      `tick (expected ~50ms). The driver is wedged, not idle.`,
    );
  }
  if (notes.length === 0) {
    notes.push('Generator healthy across every step: driver alive, no panics, no emit failures, no stalls.');
  }

  const starved = rows.find((r) => r.emitted > 0 && r.received < r.emitted * 0.9);
  if (starved) {
    notes.push(
      `TRANSPORT SATURATED at "${starved.label}": Rust emitted ${starved.emitted}, the webview ` +
      `received ${starved.received} (${Math.round((starved.received / starved.emitted) * 100)}%). ` +
      `Rows at and beyond this step measure a load the UI never got — discard them, and treat the ` +
      `event pipeline as the ceiling rather than the renderer.`,
    );
  }
  // A step that asked for chatter and served none means the frontend never
  // polled those channels — the load was generated and nobody collected it,
  // which reads as a fast renderer and is not one.
  const uncollected = rows.find((r) => r.msgs > 0 && r.servedChannel === 0);
  if (uncollected) {
    notes.push(
      `CHATTER NOT COLLECTED at "${uncollected.label}": ${uncollected.msgs} msg/s was generated and ` +
      `0 rows were served through list_team_channel. The Monitor is not polling any channel — open ` +
      `the Messages tab or Conversations so the subscription exists, or this half of the ramp is inert.`,
    );
  }

  const stalled = rows.find((r) => r.unresponsive);
  if (stalled) {
    const last = rows[rows.indexOf(stalled) - 1];
    notes.push(
      `UI WENT UNRESPONSIVE at "${stalled.label}" - the main thread could not answer a snapshot within ` +
      `15s. This is the hard ceiling and a firmer number than any percentage: at this load the window ` +
      `is not slow, it is not answering.` +
      (last
        ? ` The last step that DID answer was "${last.label}" at ${last.blockedPct.toFixed(1)}% blocked, ` +
          `p95 ${last.p95Frame.toFixed(0)}ms - so the knee is between those two.`
        : ''),
    );
  }

  const janky = rows.find((r) => r.blockedPct > 10);
  notes.push(
    janky
      ? `JANK THRESHOLD crossed at "${janky.label}" (${janky.blockedPct.toFixed(1)}% of wall clock blocked, ` +
        `p95 frame ${janky.p95Frame.toFixed(0)}ms). This is the knee — the load level where the current ` +
        `renderer stops keeping up.`
      : `No step crossed 10% blocked time. The current renderer held the whole ramp; if that is the ` +
        `real target workload, a second UI stack is not justified by this evidence.`,
  );
  const first = rows.find((r) => r.heapMb > 0);
  const last = [...rows].reverse().find((r) => r.heapMb > 0);
  if (first && last && last !== first) {
    const growth = last.heapMb - first.heapMb;
    notes.push(
      `Heap ${first.heapMb.toFixed(0)}MB -> ${last.heapMb.toFixed(0)}MB (${growth >= 0 ? '+' : ''}${growth.toFixed(0)}MB). ` +
      `Growth under a RISING ramp is expected; to tell a leak from a working set, re-run with --ramp soak, ` +
      `which holds one level and makes drift the only thing that can move the number.`,
    );
  }
  return notes;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const steps = RAMPS[args.ramp];
  if (!steps) {
    console.error(`unknown ramp "${args.ramp}" — pick one of: ${Object.keys(RAMPS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!(await reachable())) {
    console.error(
      `No test bridge at ${BASE}.\nStart the app with:  npm run tauri:dev:test\n` +
      `(or point PERSONAS_TEST_BASE at a running one)`,
    );
    process.exitCode = 1;
    return;
  }

  if (args.open) {
    const ok = await ensureMonitorOpen();
    if (!ok) {
      console.error(
        'Could not open the Monitor. A run against a closed Monitor measures an idle app very\n' +
        'thoroughly and answers nothing — open it manually, or pass --no-open if you intend to\n' +
        'measure a different surface.',
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\nload-harness · label="${args.label}" · ramp="${args.ramp}" · hold=${args.hold}s`);
  console.log(`steps: ${steps.length} · estimated ${Math.round((steps.length * args.hold) / 60)} min\n`);

  const personas = await personaIds();
  console.log(`  attributing synthetic rows to ${personas.length} real persona id(s)\n`);

  const rows = [];
  let prevHeap = null;

  try {
    for (const step of steps) {
      process.stdout.write(`  ${step.label.padEnd(10)} ...`);
      await post('/load/set', {
        sessions: step.sessions,
        linesPerSec: step.linesPerSec,
        stateFlipsPerSec: step.stateFlipsPerSec,
        sessionChurnPerMin: step.sessionChurnPerMin ?? 0,
        channelMsgsPerSec: step.channelMsgsPerSec ?? 0,
        reviewsPending: step.reviewsPending ?? 0,
        personaIds: personas,
      });
      // Let the step's session churn settle BEFORE the measurement window opens,
      // so the refetch storm from membership change is not attributed to steady
      // state. Then zero both sides together.
      await sleep(1500);
      await post('/load/reset-counters');
      await post('/perf/reset');

      await sleep(args.hold * 1000);

      // THE MOST INTERESTING STEP IS THE ONE THAT DOES NOT ANSWER.
      //
      // The perf snapshot travels through the webview, so a main thread blocked
      // past the bridge's 15s timeout cannot report it - and the first version
      // treated that as an error and threw the whole run away at exactly the
      // load worth knowing about. A step that cannot answer IS the finding:
      // record it, mark it, keep going.
      let snap = null;
      let unresponsive = false;
      try {
        snap = await get('/perf/snapshot');
      } catch {
        unresponsive = true;
      }
      // The generator's status comes from Rust and answers even when the webview
      // cannot, which is what lets an unresponsive step still report how much
      // load was applied to produce that state.
      let status = {};
      try {
        status = await get('/load/status');
      } catch {
        status = {};
      }

      const recv = (snap?.eventsReceived ?? []).reduce((n, e) => n + e.count, 0);
      const emitted = (status.emittedOutput ?? 0) + (status.emittedState ?? 0);
      const heapMb = mb(snap?.memory?.usedJSHeapSize);
      const row = {
        label: step.label,
        sessions: status.liveSessions ?? step.sessions,
        linesPerSec: step.linesPerSec,
        emitted,
        received: recv,
        // Validity signals from the generator itself. A run where any of these
        // is non-clean did not apply the load on its label, so the renderer
        // numbers beside it are measuring something else.
        emitErrors: status.emitErrors ?? 0,
        tickPanics: status.tickPanics ?? 0,
        driverAlive: status.driverAlive !== false,
        sinceLastTickMs: status.sinceLastTickMs ?? 0,
        commits: snap?.render?.commitCount ?? 0,
        actualMs: snap?.render?.totalActualDurationMs ?? 0,
        longTasks: snap?.longTasks?.count ?? 0,
        blockedPct: snap?.longTasks?.blockedPct ?? 0,
        p95Frame: snap?.frames?.p95Ms ?? 0,
        framesOver50: snap?.frames?.over50ms ?? 0,
        heapMb,
        heapDeltaMb: prevHeap == null ? 0 : Math.round((heapMb - prevHeap) * 10) / 10,
        ipcCalls: snap?.ipc?.totalCount ?? 0,
        msgs: step.channelMsgsPerSec ?? 0,
        heldChannel: status.heldChannel ?? 0,
        servedChannel: status.servedChannel ?? 0,
        servedReviews: status.servedReviews ?? 0,
        churned: Number(status.churned ?? 0),
        unresponsive,
        raw: { snapshot: snap, status },
      };
      prevHeap = heapMb;
      rows.push(row);
      process.stdout.write(
        unresponsive
          ? ` UI UNRESPONSIVE (no snapshot inside the bridge 15s window), emitted ${emitted}\n`
          : ` blocked ${row.blockedPct.toFixed(1)}%, p95 ${row.p95Frame.toFixed(0)}ms, recv ${recv}/${emitted}\n`,
      );
    }
  } finally {
    // Always tear the synthetic population down, including on Ctrl-C or a
    // mid-run throw — leaving 200 fake sessions in the registry would poison
    // both the operator's next look at the app and the next run's baseline.
    // Stop, then CONFIRM the frontend actually converged.
    //
    // The Rust side going to zero is not the same as the board going to zero: a
    // run that ended with an unresponsive webview can miss the clear-down event
    // entirely, leaving phantom nodes on the operator's board (measured: 144 of
    // them). A second stop after a pause re-emits, and the count is reported so
    // a run that could not clean up says so instead of looking tidy.
    await post('/load/stop').catch(() => {});
    await sleep(2500);
    const final = await post('/load/stop').catch(() => ({}));
    if ((final.liveSessions ?? 0) > 0) {
      console.log(`
  WARNING: ${final.liveSessions} synthetic session(s) still in the registry.
`);
    }
  }

  console.log('\n' + renderTable(rows) + '\n');
  for (const n of verdict(rows)) console.log('· ' + n + '\n');

  if (!rows.some((r) => r.longTasks > 0) && rows.some((r) => r.emitted > 0)) {
    console.log(
      '· NOTE: zero long tasks across every step. Confirm `diagnostics.longTasksSupported` is true\n' +
      '  in the JSON — if it is false, this engine has no `longtask` entry type and the jank column\n' +
      '  is empty because nothing was measured, not because nothing blocked.\n',
    );
  }

  const dir = resolve(ROOT, args.out);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${stamp}__${args.label}__${args.ramp}.json`);
  writeFileSync(
    file,
    JSON.stringify({ label: args.label, ramp: args.ramp, holdSec: args.hold, at: new Date().toISOString(), rows }, null, 2),
  );
  console.log(`saved: ${file}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
