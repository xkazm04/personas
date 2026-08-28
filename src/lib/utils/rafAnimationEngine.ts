/**
 * Shared requestAnimationFrame animation engine.
 *
 * Instead of N independent framer-motion springs each firing setState at 60fps,
 * a single rAF callback interpolates all registered targets and writes directly
 * to the DOM via refs — zero React reconciliation during animation.
 *
 * Spring physics: `MOTION.spring.soft` — the readout spring (stiffness 50,
 * damping 15), deliberately six times softer than the app's default
 * `MOTION.spring.snappy`. A gliding counter has to be readable; a control
 * answering a press does not.
 *
 * That distinction was previously undeclared: these numbers sat inline under a
 * comment claiming they matched "the previous framer-motion config", which had
 * by then been 300/25 for long enough that the claim was simply false, and a
 * component animating one property here and another through Framer got two
 * unrelated motion characters with nothing saying that was intended.
 */

import { silentCatch } from '@/lib/silentCatch';
import { MOTION } from '@/lib/utils/designTokens';

interface AnimationEntry {
  /** Current interpolated value */
  current: number;
  /** Current velocity */
  velocity: number;
  /** Target value to animate toward */
  target: number;
  /** Callback to write the interpolated value (typically updates a DOM node) */
  write: (value: number) => void;
}

const entries = new Map<symbol, AnimationEntry>();
let rafId: number | null = null;
let lastTime: number | null = null;

// Spring constants — the named readout spring, not a fourth set of numbers.
const { stiffness: STIFFNESS, damping: DAMPING, mass: MASS } = MOTION.spring.soft;
const REST_THRESHOLD = 0.01; // value + velocity both below this → settled

/**
 * Whether the user asked for reduced motion, read live — at each target change
 * AND once per frame of the running loop.
 *
 * The preference is honored HERE rather than in each caller: this engine is the
 * single place every scripted spring in the app runs, so a component that
 * forgets to check cannot produce travelling motion. Callers that only want a
 * *presentational* downgrade (a digit roll becoming a cross-fade) still make
 * that choice themselves — what this guard removes is the travel, which is the
 * part the preference is about.
 *
 * It used to be sampled at target-set time ONLY, which is the one moment a
 * user who is bothered by the motion has not yet reacted to it: enabling the
 * preference mid-flight left the current travel running to completion, and an
 * entry whose target never moved again never re-read it at all. The loop is the
 * only place that observes every animating entry on every frame, so that is
 * where the question belongs.
 *
 * Deliberately not cached: the preference can change mid-session, and one
 * `matchMedia` read per frame (not per entry, and only while something is
 * actually animating) is far cheaper than the physics it gates. Guarded for
 * environments without `matchMedia` (jsdom without the shim, SSR), where it
 * reads as "no preference expressed" and full motion is correct.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // intentional: a malformed/unsupported media query must not stop animation
    return false;
  }
}

function tick(now: number) {
  if (lastTime === null) {
    lastTime = now;
    rafId = requestAnimationFrame(tick);
    return;
  }

  // Cap dt to avoid huge jumps after tab-switch
  const dt = Math.min((now - lastTime) / 1000, 0.064);
  lastTime = now;

  // One decider, read once per frame, before any physics runs. A user who turns
  // reduced motion on mid-flight gets the resolved end state on the very next
  // frame rather than having to watch the current travel finish.
  if (prefersReducedMotion()) {
    for (const [key, entry] of entries) {
      if (entry.current === entry.target && entry.velocity === 0) continue;
      entry.current = entry.target;
      entry.velocity = 0;
      try {
        entry.write(entry.target);
      } catch (err) {
        entries.delete(key);
        silentCatch('lib/utils/rafAnimationEngine:write')(err);
      }
    }
    rafId = null;
    lastTime = null;
    return;
  }

  let anyActive = false;

  for (const [key, entry] of entries) {
    const displacement = entry.current - entry.target;
    const springForce = -STIFFNESS * displacement;
    const dampingForce = -DAMPING * entry.velocity;
    const acceleration = (springForce + dampingForce) / MASS;

    entry.velocity += acceleration * dt;
    entry.current += entry.velocity * dt;

    // Check if settled
    if (
      Math.abs(entry.current - entry.target) < REST_THRESHOLD &&
      Math.abs(entry.velocity) < REST_THRESHOLD
    ) {
      entry.current = entry.target;
      entry.velocity = 0;
    }

    // A throwing `write` used to escape `tick` before it could re-arm the
    // frame. `rafId` still held the handle of the frame that had just fired, so
    // `ensureRunning` saw a live loop, scheduled nothing, and EVERY animation in
    // the app stayed frozen for the rest of the session. Evict the offending
    // entry instead and keep the shared loop alive for its neighbours.
    try {
      entry.write(entry.current);
    } catch (err) {
      entries.delete(key);
      silentCatch('lib/utils/rafAnimationEngine:write')(err);
      continue;
    }

    // Still animating?
    if (entry.current !== entry.target || entry.velocity !== 0) {
      anyActive = true;
    }
  }

  if (anyActive) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
    lastTime = null;
  }
}

function ensureRunning() {
  if (rafId === null) {
    lastTime = null;
    rafId = requestAnimationFrame(tick);
  }
}

/**
 * Register an animation target. Returns a symbol key for updates / cleanup.
 */
export function registerAnimation(
  initialValue: number,
  write: (value: number) => void,
): symbol {
  const key = Symbol();
  entries.set(key, {
    current: initialValue,
    velocity: 0,
    target: initialValue,
    write,
  });
  write(initialValue);
  return key;
}

/**
 * Update the target value for a registered animation. Starts the rAF loop if idle.
 *
 * Under `prefers-reduced-motion: reduce` the value is snapped instead: these
 * animations carry content (a counter's figure is the number the reader came
 * for), so the reduced form is the resolved end state delivered immediately —
 * never nothing, and never a slower version of the same travel.
 */
export function setAnimationTarget(key: symbol, target: number) {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.target === target) return;
  if (prefersReducedMotion()) {
    snapAnimation(key, target);
    return;
  }
  entry.target = target;
  ensureRunning();
}

/**
 * Snap to value immediately (no animation).
 */
export function snapAnimation(key: symbol, value: number) {
  const entry = entries.get(key);
  if (!entry) return;
  entry.current = value;
  entry.velocity = 0;
  entry.target = value;
  entry.write(value);
}

/**
 * Unregister an animation target.
 */
export function unregisterAnimation(key: symbol) {
  entries.delete(key);
  // If nothing left, the loop will stop on its own next tick
}
