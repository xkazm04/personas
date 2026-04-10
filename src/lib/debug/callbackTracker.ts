/** Monkey-patches async scheduling APIs to track which callback is executing when a freeze occurs.
 *  Only patches when explicitly enabled via `patchAll()`. Call `unpatchAll()` to restore originals. */

const _setTimeout = window.setTimeout.bind(window);
const _setInterval = window.setInterval.bind(window);
const _rAF = window.requestAnimationFrame.bind(window);
const _moObserve = MutationObserver.prototype.observe;

export let currentCallback: string | null = null;

interface ObserverStats { count: number; resetAt: number; }
const observerHits = new WeakMap<MutationObserver | ResizeObserver, ObserverStats>();
const RATE_LIMIT = 50; // fires per second

function stack5(): string {
  return (new Error().stack ?? '').split('\n').slice(2, 7).join('\n');
}

function wrapFn(fn: TimerHandler, label: string, s: string): TimerHandler {
  if (typeof fn !== 'function') return fn;
  return function (this: unknown, ...args: unknown[]) {
    currentCallback = `${label}\n${s}`;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- wrapping arbitrary timer callbacks
    try { return (fn as Function).apply(this, args); }
    finally { currentCallback = null; }
  } as unknown as TimerHandler;
}

function checkRate(obs: MutationObserver | ResizeObserver): boolean {
  const now = performance.now();
  let s = observerHits.get(obs);
  if (!s || now - s.resetAt > 1000) { s = { count: 0, resetAt: now }; observerHits.set(obs, s); }
  if (++s.count > RATE_LIMIT) {
    console.warn(`[freeze-detector] Observer exceeded ${RATE_LIMIT}/s, auto-disconnecting`, obs);
    obs.disconnect();
    return false;
  }
  return true;
}

let patched = false;

export function patchAll(): void {
  if (patched) return;
  patched = true;

  window.setTimeout = function (fn: TimerHandler, ms?: number, ...rest: unknown[]) {
    return _setTimeout(wrapFn(fn, 'setTimeout', stack5()), ms, ...rest);
  } as typeof window.setTimeout;

  window.setInterval = function (fn: TimerHandler, ms?: number, ...rest: unknown[]) {
    return _setInterval(wrapFn(fn, 'setInterval', stack5()), ms, ...rest);
  } as typeof window.setInterval;

  window.requestAnimationFrame = function (fn: FrameRequestCallback) {
    const s = stack5();
    return _rAF((ts) => {
      currentCallback = `rAF\n${s}`;
      try { fn(ts); } finally { currentCallback = null; }
    });
  };

  MutationObserver.prototype.observe = function (this: MutationObserver, target: Node, opts?: MutationObserverInit) {
    if (!observerHits.has(this)) observerHits.set(this, { count: 0, resetAt: performance.now() });
    return _moObserve.call(this, target, opts);
  };

  const _MO = window.MutationObserver;
  window.MutationObserver = class extends _MO {
    constructor(cb: MutationCallback) {
      super((mutations, observer) => {
        if (!checkRate(observer)) return;
        currentCallback = 'MutationObserver callback';
        try { cb(mutations, observer); } finally { currentCallback = null; }
      });
    }
  } as typeof MutationObserver;

  const _RO = window.ResizeObserver;
  window.ResizeObserver = class extends _RO {
    constructor(cb: ResizeObserverCallback) {
      super((entries, observer) => {
        if (!checkRate(observer)) return;
        currentCallback = 'ResizeObserver callback';
        try { cb(entries, observer); } finally { currentCallback = null; }
      });
    }
  } as typeof ResizeObserver;
}

export function unpatchAll(): void {
  if (!patched) return;
  patched = false;
  window.setTimeout = _setTimeout as unknown as typeof window.setTimeout;
  window.setInterval = _setInterval as unknown as typeof window.setInterval;
  window.requestAnimationFrame = _rAF;
  MutationObserver.prototype.observe = _moObserve;
}
