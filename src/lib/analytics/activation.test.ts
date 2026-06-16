import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setAnalyticsSink, sentrySink, type ConversionEvent, type AnalyticsSink } from './sink';
import {
  ACTIVATION_FUNNEL,
  getInstallId,
  markActivation,
  getReachedActivations,
  hasReachedActivation,
  captureReferrerOnce,
  getReferrer,
} from './activation';

// In-memory localStorage so the dedupe/persistence is exercised deterministically.
function installMemoryStorage() {
  const map = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
  vi.stubGlobal('localStorage', stub);
  // jsdom exposes window.localStorage; keep them the same object.
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });
  }
  return map;
}

let captured: ConversionEvent[] = [];
const capturingSink: AnalyticsSink = {
  feature: () => {},
  interaction: () => {},
  session: () => {},
  conversion: (e) => captured.push(e),
};

beforeEach(() => {
  installMemoryStorage();
  captured = [];
  setAnalyticsSink(capturingSink);
});

afterEach(() => {
  setAnalyticsSink(sentrySink);
  vi.unstubAllGlobals();
});

describe('activation funnel', () => {
  it('mints a stable, opaque install id', () => {
    const a = getInstallId();
    const b = getInstallId();
    expect(a).toBe(b);
    expect(a).not.toBe('ephemeral');
    expect(a.length).toBeGreaterThan(8);
  });

  it('fires a conversion the first time a milestone is marked, with the right ordinal', () => {
    const fired = markActivation('persona_created');
    expect(fired).toBe(true);
    expect(captured).toHaveLength(1);
    const ev = captured[0]!;
    expect(ev.step).toBe('persona_created');
    expect(ev.ordinal).toBe(ACTIVATION_FUNNEL.indexOf('persona_created') + 1);
    expect(ev.installId).toBe(getInstallId());
  });

  it('is fire-once per install — the same milestone never double-fires', () => {
    expect(markActivation('execution_completed')).toBe(true);
    expect(markActivation('execution_completed')).toBe(false);
    expect(markActivation('execution_completed')).toBe(false);
    expect(captured.filter((c) => c.step === 'execution_completed')).toHaveLength(1);
  });

  it('tracks reached milestones in funnel order', () => {
    markActivation('execution_completed');
    markActivation('persona_created');
    expect(hasReachedActivation('persona_created')).toBe(true);
    expect(hasReachedActivation('shared')).toBe(false);
    // returned in ACTIVATION_FUNNEL order regardless of insertion order
    expect(getReachedActivations()).toEqual(['persona_created', 'execution_completed']);
  });

  it('captures a referrer once and never overwrites it', () => {
    captureReferrerOnce('alice');
    captureReferrerOnce('bob');
    expect(getReferrer()).toBe('alice');
  });

  it('routes through the active sink, so telemetry-off (noop) fires nothing', () => {
    setAnalyticsSink({
      feature: () => {},
      interaction: () => {},
      session: () => {},
      conversion: () => {},
    });
    expect(markActivation('shared')).toBe(true); // dedupe state still advances
    expect(captured).toHaveLength(0); // ...but nothing reached the capturing sink
  });
});
