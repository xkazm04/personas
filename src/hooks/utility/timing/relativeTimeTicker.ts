import { useEffect, useReducer, useRef, useState } from 'react';

/**
 * Shared, self-scaling ticker for relative-time labels.
 *
 * Problem this solves: every relative-time label (`5m ago`, `scanned 12s ago`,
 * rotation countdowns, …) used to spin its own `setInterval`. Dozens of
 * independent timers waste wake-ups and drift out of sync, and a fixed 15s
 * interval can leave a label stale for up to 15s past a boundary (showing
 * `59m ago` well into the next hour).
 *
 * This module runs a SINGLE timer for the whole app. Each subscriber declares
 * the cadence it needs; the timer fires at the finest cadence any live
 * subscriber requires. The cadence self-scales with a label's age — sub-second
 * precision isn't needed for a 3-day-old timestamp, and a 5-minute interval is
 * far too coarse for a `12s ago` label.
 *
 * Cadence buckets (see {@link cadenceForAge}):
 *   - age < 1 minute  → tick every 1s
 *   - age < 1 hour    → tick every 30s
 *   - age ≥ 1 hour    → tick every 5m
 *
 * TWO PROPERTIES THIS MODULE DID NOT HAVE UNTIL 2026-10-06, both measured on
 * the Activity surface, and both of the "one timer for everyone" design's own
 * making:
 *
 *  1. THE CADENCE WAS CONTAGIOUS. The timer fired at the finest cadence any
 *     subscriber needed and then called EVERY subscriber on that tick. One
 *     `RelativeTime` showing a value under a minute old — a usage fetch time
 *     (`PlanPlates`), a running persona's elapsed time (`fleetboard/Tile`) —
 *     therefore re-rendered the whole app at 1 Hz, including the three Activity
 *     panels that each asked for 30s. The timer's cadence is still the finest
 *     any subscriber needs (that is what keeps a 1s label honest), but a
 *     subscriber now carries its OWN due time and is called only when that time
 *     arrives. A 30s subscriber is called every 30s no matter what else is on
 *     the board.
 *
 *  2. IT TICKED WHILE THE DOCUMENT WAS HIDDEN. `setInterval` is throttled in a
 *     background tab but not stopped, and in a Tauri window that is merely
 *     occluded it is not throttled at all — so a minimised app went on
 *     re-rendering every subscriber once a second forever. The timer now stops
 *     on `visibilitychange` and restarts on the way back, firing every
 *     subscriber once as it does, because a label that was hidden for an hour
 *     is an hour stale and has to catch up in one go rather than on its next
 *     due tick.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Timer jitter slack. `setInterval` is allowed to deliver a tick a hair early,
 * and a subscriber whose due time is 1ms away should be served by the tick it
 * is obviously meant for rather than waiting a whole extra period. One frame is
 * the largest error that can never add a visible period to any cadence here
 * (the finest is 1s).
 */
const DUE_SLACK_MS = 16;

/**
 * Choose how often a label for a timestamp of the given age (ms) needs to
 * refresh. Younger labels change faster, so they tick faster.
 */
export function cadenceForAge(ageMs: number): number {
  const age = Math.abs(ageMs);
  if (age < MINUTE) return SECOND; // sub-minute: every second
  if (age < HOUR) return 30 * SECOND; // sub-hour: every 30s
  return 5 * MINUTE; // beyond an hour: every 5 minutes
}

interface Subscriber {
  cb: () => void;
  cadence: number;
  /** Epoch ms at which this subscriber is next owed a call. */
  dueAt: number;
}

const subscribers = new Set<Subscriber>();
let timerId: ReturnType<typeof setInterval> | null = null;
let timerCadence = 0;
let documentHidden = false;

function smallestCadence(): number {
  let min = Infinity;
  for (const s of subscribers) {
    if (s.cadence < min) min = s.cadence;
  }
  return min;
}

function stopTimer(): void {
  if (timerId !== null) clearInterval(timerId);
  timerId = null;
  timerCadence = 0;
}

/**
 * One tick of the shared timer: call the subscribers that are DUE, and only
 * those. The snapshot to a plain array matters because a subscriber's callback
 * may schedule a cadence change (and thus a reschedule) mid-iteration.
 */
function fireDue(): void {
  const now = Date.now();
  for (const s of [...subscribers]) {
    if (s.dueAt - now > DUE_SLACK_MS) continue;
    s.dueAt = now + s.cadence;
    s.cb();
  }
}

/** Call EVERY subscriber and re-arm it — the catch-up after a hidden spell. */
function fireAll(): void {
  const now = Date.now();
  for (const s of [...subscribers]) {
    s.dueAt = now + s.cadence;
    s.cb();
  }
}

/**
 * Recompute the global timer to match the finest cadence any live subscriber
 * needs. Stops the timer entirely when there are no subscribers or the document
 * is hidden; restarts it only when the target cadence actually changes (so a
 * no-op realignment after a tick doesn't thrash the timer).
 */
function reschedule(): void {
  const target = smallestCadence();

  if (!Number.isFinite(target) || documentHidden) {
    stopTimer();
    return;
  }

  if (timerId !== null && target === timerCadence) return;

  if (timerId !== null) clearInterval(timerId);
  timerCadence = target;
  timerId = setInterval(fireDue, target);
}

/** Test override for the document's visibility; `null` = ask the real document. */
let hiddenOverrideForTests: boolean | null = null;

function readHidden(): boolean {
  if (hiddenOverrideForTests !== null) return hiddenOverrideForTests;
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function handleVisibilityChange(): void {
  const next = readHidden();
  if (next === documentHidden) return;
  documentHidden = next;
  if (documentHidden) {
    stopTimer();
    return;
  }
  // Back on screen. Every label is as stale as the time we spent away, so they
  // all catch up now rather than waiting out their own periods.
  fireAll();
  reschedule();
}

if (typeof document !== 'undefined') {
  documentHidden = readHidden();
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function subscribe(cb: () => void, cadence: number): Subscriber {
  const sub: Subscriber = { cb, cadence, dueAt: Date.now() + cadence };
  subscribers.add(sub);
  reschedule();
  return sub;
}

function unsubscribe(sub: Subscriber): void {
  if (subscribers.delete(sub)) reschedule();
}

function setCadence(sub: Subscriber, cadence: number): void {
  if (sub.cadence === cadence) return;
  sub.cadence = cadence;
  // Never push a due time further out than the new cadence allows: a label that
  // just crossed into a finer bucket must not wait out the coarser period.
  sub.dueAt = Math.min(sub.dueAt, Date.now() + cadence);
  reschedule();
}

/**
 * Subscribe to the shared ticker for a relative-time label. Re-renders the
 * calling component on each tick THIS subscriber is due for, at a cadence
 * derived from the timestamp's age. Pass `null` for an absent timestamp to opt
 * out entirely (no subscription, no timer pressure).
 */
export function useRelativeTimeTick(timestampMs: number | null): void {
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const subRef = useRef<Subscriber | null>(null);

  useEffect(() => {
    if (timestampMs == null) {
      subRef.current = null;
      return;
    }
    const sub = subscribe(bump, cadenceForAge(Date.now() - timestampMs));
    subRef.current = sub;
    return () => {
      unsubscribe(sub);
      subRef.current = null;
    };
  }, [timestampMs]);

  // The label's age advances between renders and may cross a bucket boundary
  // (e.g. `58s ago` → `1m ago`); realign this subscriber's cadence each render.
  useEffect(() => {
    const sub = subRef.current;
    if (sub == null || timestampMs == null) return;
    setCadence(sub, cadenceForAge(Date.now() - timestampMs));
  });
}

/**
 * Subscribe to the shared ticker at a fixed cadence (no age scaling). For
 * countdown/forward-looking displays that just need a steady re-render pulse
 * without spinning their own interval. Returns an incrementing tick counter.
 */
export function useFixedTicker(cadenceMs: number): number {
  const [tick, bump] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    const sub = subscribe(bump, cadenceMs);
    return () => unsubscribe(sub);
  }, [cadenceMs]);

  return tick;
}

/**
 * A `now` that only moves on the shared ticker, QUANTIZED to the cadence.
 *
 * Use this instead of `useFixedTicker()` + `Date.now()` in render. Reading the
 * clock during render gives a value that is different on every render for
 * reasons that have nothing to do with time passing — a parent re-render, a
 * store update, a hover — so every `useMemo`/`useCallback` that closes over it
 * is invalidated on every render, and every memoized child that takes it as a
 * prop re-renders. Quantizing to the subscriber's own cadence makes the value
 * CHANGE only when the displayed labels can have changed, and the `useState`
 * setter bails out of the re-render entirely when it has not (a redundant call
 * — the catch-up after a hidden spell, a cadence realignment — costs nothing).
 */
export function useQuantizedNow(cadenceMs: number): number {
  // The grid is anchored at MOUNT, not at the epoch, for two reasons: the first
  // value is then the exact clock rather than up to a period behind it, and the
  // subscriber's own due times fall on the same grid (`subscribe` arms it at
  // `now + cadence`), so each tick lands within timer jitter of a grid line.
  const originRef = useRef(Date.now());
  const [now, setNow] = useState(originRef.current);

  useEffect(() => {
    const origin = originRef.current;
    const read = () => setNow(origin + Math.floor((Date.now() - origin) / cadenceMs) * cadenceMs);
    read();
    const sub = subscribe(read, cadenceMs);
    return () => unsubscribe(sub);
  }, [cadenceMs]);

  return now;
}

// --- Test-only internals ----------------------------------------------------

/** @internal Inspect ticker state in tests. */
export function _tickerStateForTests(): {
  subscriberCount: number;
  timerCadence: number;
  running: boolean;
  hidden: boolean;
} {
  return {
    subscriberCount: subscribers.size,
    timerCadence,
    running: timerId !== null,
    hidden: documentHidden,
  };
}

/** @internal Force a tick (invoke every subscriber) in tests. */
export function _forceTickForTests(): void {
  fireAll();
}

/**
 * @internal Drive the REAL visibility handler in tests. jsdom's
 * `document.visibilityState` is read-only and fires no event of its own, so the
 * override stands in for it; `null` hands the question back to the document.
 */
export function _setDocumentHiddenForTests(hidden: boolean | null): void {
  hiddenOverrideForTests = hidden;
  handleVisibilityChange();
}

/** @internal Reset all module state between tests. */
export function _resetTickerForTests(): void {
  subscribers.clear();
  stopTimer();
  hiddenOverrideForTests = null;
  documentHidden = readHidden();
}
