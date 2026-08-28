import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerAnimation,
  setAnimationTarget,
  snapAnimation,
  unregisterAnimation,
} from '../rafAnimationEngine';

/**
 * The engine drives itself from `requestAnimationFrame`, so the tests drive the
 * frames by hand: `rafQueue` holds the pending callbacks and `pump()` runs one
 * frame's worth at a synthetic timestamp.
 */
let rafQueue: FrameRequestCallback[] = [];
let clock = 0;

function pump(stepMs = 16) {
  const due = rafQueue;
  rafQueue = [];
  clock += stepMs;
  for (const cb of due) cb(clock);
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  rafQueue = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  setReducedMotion(false);
});

/**
 * The engine keeps its rAF handle in module state, so a test that leaves the
 * loop armed starves the next one (`ensureRunning` sees a live handle and
 * schedules nothing). Drain to a stopped loop between tests.
 */
function drain(maxFrames = 500) {
  for (let i = 0; i < maxFrames && rafQueue.length > 0; i++) pump();
}

afterEach(() => {
  drain();
  pump();
  pump();
  vi.unstubAllGlobals();
});

describe('registerAnimation', () => {
  it('writes the initial value synchronously', () => {
    const writes: number[] = [];
    const key = registerAnimation(5, (v) => writes.push(v));
    expect(writes).toEqual([5]);
    unregisterAnimation(key);
  });
});

describe('setAnimationTarget', () => {
  it('springs toward the target across frames and settles exactly on it', () => {
    let latest = 0;
    const key = registerAnimation(0, (v) => {
      latest = v;
    });
    setAnimationTarget(key, 100);

    pump(); // first frame only seeds lastTime
    pump();
    expect(latest).toBeGreaterThan(0);
    expect(latest).toBeLessThan(100);

    for (let i = 0; i < 400 && rafQueue.length > 0; i++) pump();
    expect(latest).toBe(100);
    unregisterAnimation(key);
  });

  it('is a no-op when the target is unchanged', () => {
    const writes: number[] = [];
    const key = registerAnimation(7, (v) => writes.push(v));
    setAnimationTarget(key, 7);
    expect(rafQueue).toHaveLength(0);
    expect(writes).toEqual([7]);
    unregisterAnimation(key);
  });
});

describe('reduced motion', () => {
  it('snaps to the target instead of travelling, and schedules no frames', () => {
    setReducedMotion(true);
    const writes: number[] = [];
    const key = registerAnimation(0, (v) => writes.push(v));

    setAnimationTarget(key, 1234);

    expect(writes).toEqual([0, 1234]);
    expect(rafQueue).toHaveLength(0);
    unregisterAnimation(key);
  });

  it('still travels when the preference is not set', () => {
    setReducedMotion(false);
    let latest = 0;
    const key = registerAnimation(0, (v) => {
      latest = v;
    });
    setAnimationTarget(key, 1234);
    expect(rafQueue.length).toBeGreaterThan(0);
    expect(latest).toBe(0);
    unregisterAnimation(key);
  });

  // Regression guard. The preference was sampled inside `setAnimationTarget`
  // and nowhere else, so a user who enabled reduced motion mid-flight had to
  // watch the travel already in the air run all the way to completion — the one
  // moment the preference is being expressed is the moment it was not read.
  it('resolves a travel already in flight on the next frame', () => {
    setReducedMotion(false);
    let latest = 0;
    const key = registerAnimation(0, (v) => {
      latest = v;
    });

    setAnimationTarget(key, 1000);
    pump(); // first frame only seeds `lastTime`
    pump();
    expect(latest).toBeGreaterThan(0);
    expect(latest).toBeLessThan(1000); // still travelling

    // The user turns the preference on mid-flight.
    setReducedMotion(true);
    pump();

    expect(latest).toBe(1000);
    expect(rafQueue).toHaveLength(0); // and the loop stops, rather than idling
    unregisterAnimation(key);
  });

  it('leaves a settled entry alone when the preference flips', () => {
    setReducedMotion(false);
    const writes: number[] = [];
    const key = registerAnimation(7, (v) => writes.push(v));
    const other = registerAnimation(0, () => {});

    setAnimationTarget(other, 100);
    setReducedMotion(true);
    pump();

    // `key` never moved, so the reduced-motion sweep must not re-write it.
    expect(writes).toEqual([7]);
    unregisterAnimation(key);
    unregisterAnimation(other);
  });

  it('falls back to full motion when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const key = registerAnimation(0, () => {});
    setAnimationTarget(key, 50);
    expect(rafQueue.length).toBeGreaterThan(0);
    unregisterAnimation(key);
  });
});

describe('a throwing write', () => {
  it('evicts only the offending entry and keeps the shared loop alive', () => {
    const good: number[] = [];
    let firstWrite = true;
    const bad = registerAnimation(0, () => {
      // Registration writes the initial value synchronously; blow up only once
      // the shared loop is the caller.
      if (firstWrite) {
        firstWrite = false;
        return;
      }
      throw new Error('write blew up');
    });
    const ok = registerAnimation(0, (v) => {
      good.push(v);
    });

    setAnimationTarget(bad, 100);
    setAnimationTarget(ok, 100);

    for (let i = 0; i < 400 && rafQueue.length > 0; i++) pump();

    // The healthy neighbour reached its target — the loop was never wedged.
    expect(good[good.length - 1]).toBe(100);
    unregisterAnimation(bad);
    unregisterAnimation(ok);
  });

  it('leaves the engine restartable for animations registered afterwards', () => {
    let firstWrite = true;
    const bad = registerAnimation(0, () => {
      if (firstWrite) {
        firstWrite = false;
        return;
      }
      throw new Error('write blew up');
    });
    setAnimationTarget(bad, 100);
    pump();
    pump();

    // Drain whatever the failed entry left behind.
    for (let i = 0; i < 10 && rafQueue.length > 0; i++) pump();

    let latest = 0;
    const fresh = registerAnimation(0, (v) => {
      latest = v;
    });
    setAnimationTarget(fresh, 42);
    for (let i = 0; i < 400 && rafQueue.length > 0; i++) pump();

    expect(latest).toBe(42);
    unregisterAnimation(bad);
    unregisterAnimation(fresh);
  });
});

describe('snapAnimation', () => {
  it('jumps to the value and cancels any pending travel', () => {
    let latest = 0;
    const key = registerAnimation(0, (v) => {
      latest = v;
    });
    setAnimationTarget(key, 100);
    pump();
    pump();
    snapAnimation(key, 7);
    expect(latest).toBe(7);

    for (let i = 0; i < 10 && rafQueue.length > 0; i++) pump();
    expect(latest).toBe(7);
    unregisterAnimation(key);
  });
});
