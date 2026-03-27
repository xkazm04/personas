/**
 * Shared requestAnimationFrame animation engine.
 *
 * Instead of N independent framer-motion springs each firing setState at 60fps,
 * a single rAF callback interpolates all registered targets and writes directly
 * to the DOM via refs — zero React reconciliation during animation.
 *
 * Spring physics: critically-damped spring with stiffness=50, damping=15
 * (matches the previous framer-motion config).
 */

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

// Spring constants — match the previous framer-motion config
const STIFFNESS = 50;
const DAMPING = 15;
const MASS = 1;
const REST_THRESHOLD = 0.01; // value + velocity both below this → settled

function tick(now: number) {
  if (lastTime === null) {
    lastTime = now;
    rafId = requestAnimationFrame(tick);
    return;
  }

  // Cap dt to avoid huge jumps after tab-switch
  const dt = Math.min((now - lastTime) / 1000, 0.064);
  lastTime = now;

  let anyActive = false;

  for (const entry of entries.values()) {
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

    entry.write(entry.current);

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
 */
export function setAnimationTarget(key: symbol, target: number) {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.target === target) return;
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
