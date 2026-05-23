import { useEffect, useReducer, useRef } from 'react';

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
 * subscriber requires and re-renders every subscriber on the same tick, so all
 * labels update together. The cadence self-scales with a label's age — sub-second
 * precision isn't needed for a 3-day-old timestamp, and a 5-minute interval is
 * far too coarse for a `12s ago` label.
 *
 * Cadence buckets (see {@link cadenceForAge}):
 *   - age < 1 minute  → tick every 1s
 *   - age < 1 hour    → tick every 30s
 *   - age ≥ 1 hour    → tick every 5m
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

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
}

const subscribers = new Set<Subscriber>();
let timerId: ReturnType<typeof setInterval> | null = null;
let timerCadence = 0;

function smallestCadence(): number {
  let min = Infinity;
  for (const s of subscribers) {
    if (s.cadence < min) min = s.cadence;
  }
  return min;
}

/**
 * Recompute the global timer to match the finest cadence any live subscriber
 * needs. Stops the timer entirely when there are no subscribers; restarts it
 * only when the target cadence actually changes (so a no-op realignment after
 * a tick doesn't thrash the timer).
 */
function reschedule(): void {
  const target = smallestCadence();

  if (!Number.isFinite(target)) {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
      timerCadence = 0;
    }
    return;
  }

  if (timerId !== null && target === timerCadence) return;

  if (timerId !== null) clearInterval(timerId);
  timerCadence = target;
  timerId = setInterval(() => {
    // Snapshot to a plain array: a subscriber's callback may schedule a
    // cadence change (and thus reschedule) mid-iteration.
    for (const s of [...subscribers]) s.cb();
  }, target);
}

function subscribe(cb: () => void, cadence: number): Subscriber {
  const sub: Subscriber = { cb, cadence };
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
  reschedule();
}

/**
 * Subscribe to the shared ticker for a relative-time label. Re-renders the
 * calling component on each shared tick, at a cadence derived from the
 * timestamp's age. Pass `null` for an absent timestamp to opt out entirely
 * (no subscription, no timer pressure).
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

// --- Test-only internals ----------------------------------------------------

/** @internal Inspect ticker state in tests. */
export function _tickerStateForTests(): {
  subscriberCount: number;
  timerCadence: number;
  running: boolean;
} {
  return {
    subscriberCount: subscribers.size,
    timerCadence,
    running: timerId !== null,
  };
}

/** @internal Force a tick (invoke every subscriber) in tests. */
export function _forceTickForTests(): void {
  for (const s of [...subscribers]) s.cb();
}

/** @internal Reset all module state between tests. */
export function _resetTickerForTests(): void {
  subscribers.clear();
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  timerCadence = 0;
}
