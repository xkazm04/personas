// ---------------------------------------------------------------------------
// Silent-failure telemetry
//
// `silentCatch` swallows an error with a Sentry breadcrumb and a console warn.
// With 250+ call sites, the aggregate swallow rate is an unmeasured failure
// surface — no single breadcrumb tells you "auth:refresh has failed 400 times
// this session". This module aggregates swallows per call-site tag and emits a
// periodic rollup (one structured log line + one Sentry breadcrumb summary),
// plus a rate-limited sampled `captureException` for high-frequency tags so a
// genuinely-broken path surfaces as a real Sentry issue, not just a breadcrumb.
//
// Design constraints:
//   • ZERO change at the 250+ call sites — `silentCatch`/`silentCatchNull` call
//     `recordSwallow` internally; callers are untouched.
//   • Zero user-visible effect — telemetry only.
//   • Survives HMR — state lives on `globalThis` (same pattern as
//     executionBuffers / eventBus) so hot-reloads don't reset the counters.
// ---------------------------------------------------------------------------

import * as Sentry from '@sentry/react';
import { log } from './log';

// --- Tunables (exported so tests can reference, not mutate) -----------------

/** Flush a rollup once this many swallows have accumulated in the window. */
export const SWALLOW_ROLLUP_MAX = 100;
/** …or once this much wall-clock time has passed with ≥1 swallow pending. */
export const SWALLOW_ROLLUP_INTERVAL_MS = 5 * 60_000;
/** Top-N tags (by count) included in each rollup summary. */
export const SWALLOW_ROLLUP_TOP_N = 8;
/** Sample a `captureException` on every Nth occurrence of a single tag. */
export const SWALLOW_SAMPLE_EVERY = 25;
/** Global floor between sampled captures — a swallow storm can't flood Sentry. */
export const SWALLOW_SAMPLE_MIN_INTERVAL_MS = 60_000;

// --- State (HMR-durable singleton) ------------------------------------------

interface TagStat {
  count: number;
  firstAt: number;
  lastAt: number;
  lastMessage: string;
  sampledCaptures: number;
}

interface TrackerState {
  /** Per-tag stats for the CURRENT window (cleared on each rollup). */
  tags: Map<string, TagStat>;
  /** Swallows accumulated since the last rollup. */
  windowTotal: number;
  /** Swallows since the tracker was created (never reset). */
  sessionTotal: number;
  /** Timestamp of the last rollup (or tracker creation). */
  lastRollupAt: number;
  /** Timestamp of the last sampled capture (global rate-limit anchor). */
  lastSampleAt: number;
}

const GLOBAL_KEY = '__personasSwallowTracker__';

function getState(now: number): TrackerState {
  const g = globalThis as Record<string, unknown>;
  let state = g[GLOBAL_KEY] as TrackerState | undefined;
  if (!state) {
    state = {
      tags: new Map(),
      windowTotal: 0,
      sessionTotal: 0,
      lastRollupAt: now,
      lastSampleAt: 0,
    };
    g[GLOBAL_KEY] = state;
  }
  return state;
}

// --- Public API -------------------------------------------------------------

/**
 * Record one swallowed error under a call-site `tag`. Called by
 * `silentCatch` / `silentCatchNull`; not intended for direct use.
 *
 * `err` (when an Error) is what a sampled capture reports — pass it so Sentry
 * gets a real stack for high-frequency tags. `now` is injectable for tests.
 */
export function recordSwallow(
  tag: string,
  message: string,
  err?: unknown,
  now: number = Date.now(),
): void {
  const state = getState(now);

  let stat = state.tags.get(tag);
  if (!stat) {
    stat = { count: 0, firstAt: now, lastAt: now, lastMessage: message, sampledCaptures: 0 };
    state.tags.set(tag, stat);
  }
  stat.count += 1;
  stat.lastAt = now;
  stat.lastMessage = message;
  state.windowTotal += 1;
  state.sessionTotal += 1;

  maybeSample(state, tag, stat, message, err, now);
  maybeRollup(state, now);
}

/**
 * Force a rollup flush now (used at test boundaries and could be wired to a
 * visibility-change / beforeunload handler). No-op when nothing is pending.
 */
export function flushSwallowRollupNow(now: number = Date.now()): void {
  const state = getState(now);
  if (state.windowTotal > 0) flushRollup(state, now);
}

/** Read-only snapshot for diagnostics / tests. */
export function getSwallowSnapshot(now: number = Date.now()): {
  windowTotal: number;
  sessionTotal: number;
  distinctTags: number;
} {
  const state = getState(now);
  return {
    windowTotal: state.windowTotal,
    sessionTotal: state.sessionTotal,
    distinctTags: state.tags.size,
  };
}

/** Test-only: wipe the singleton so each test starts from a clean tracker. */
export function __resetSwallowTrackerForTests(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = undefined;
}

// --- Internals --------------------------------------------------------------

function maybeSample(
  state: TrackerState,
  tag: string,
  stat: TagStat,
  message: string,
  err: unknown,
  now: number,
): void {
  // Nothing to capture when the caller had no error value in hand.
  if (err === undefined) return;
  // Only sample once a tag is demonstrably high-frequency (every Nth hit), and
  // never more than one capture per global cool-down — this is the rate limit.
  const isSampleTick = stat.count % SWALLOW_SAMPLE_EVERY === 0;
  // lastSampleAt === 0 means "never sampled" — the first capture is always
  // allowed; thereafter the global cool-down rate-limits.
  const coolDownElapsed =
    state.lastSampleAt === 0 || now - state.lastSampleAt >= SWALLOW_SAMPLE_MIN_INTERVAL_MS;
  if (!isSampleTick || !coolDownElapsed) return;

  state.lastSampleAt = now;
  stat.sampledCaptures += 1;

  // Reuse the app Sentry path — beforeSend (src/lib/sentry.ts) scrubs PII from
  // the message and exception value.
  const error = err instanceof Error ? err : new Error(`[silent] ${tag}: ${message}`);
  Sentry.captureException(error, {
    level: 'warning',
    tags: { silent_swallow: tag },
    extra: { swallowCount: stat.count, sampledEvery: SWALLOW_SAMPLE_EVERY },
  });
}

function maybeRollup(state: TrackerState, now: number): void {
  const dueByCount = state.windowTotal >= SWALLOW_ROLLUP_MAX;
  const dueByTime = now - state.lastRollupAt >= SWALLOW_ROLLUP_INTERVAL_MS;
  if (!dueByCount && !dueByTime) return;
  if (state.windowTotal === 0) {
    // Time elapsed but nothing to report — just slide the window anchor.
    state.lastRollupAt = now;
    return;
  }
  flushRollup(state, now);
}

function flushRollup(state: TrackerState, now: number): void {
  const top = [...state.tags.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, SWALLOW_ROLLUP_TOP_N)
    .map(([tag, s]) => ({ tag, count: s.count, lastMessage: s.lastMessage }));

  const summary = {
    windowTotal: state.windowTotal,
    sessionTotal: state.sessionTotal,
    distinctTags: state.tags.size,
    windowMs: now - state.lastRollupAt,
    top,
  };

  log.info('silentFailures', 'swallow rollup', summary);
  Sentry.addBreadcrumb({
    category: 'silentFailure.rollup',
    level: 'info',
    message: `${state.windowTotal} swallowed errors across ${state.tags.size} tag(s)`,
    data: summary,
  });

  // Reset the window; session cumulative + sample cool-down persist.
  state.tags.clear();
  state.windowTotal = 0;
  state.lastRollupAt = now;
}
