import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setAnalyticsSink, sentrySink, noopSink, type SessionSummary } from './sink';
import { initAnalytics, __resetAnalyticsSessionForTests } from './index';

// A session summary used to flush on `beforeunload` alone. The Tauri WebView
// tears down on a path where that event does not fire (the same reason
// `throttledStorage.ts` and `notepadStore.ts` pair `pagehide` with it), so
// whole desktop sessions never reported — and an unreported session reads as a
// session that ignored nothing.
describe('initAnalytics — session summary flush', () => {
  let seen: SessionSummary[];
  let stop: (() => void) | null = null;

  beforeEach(() => {
    __resetAnalyticsSessionForTests();
    seen = [];
    setAnalyticsSink({ ...noopSink, session: (s) => seen.push(s) });
  });

  afterEach(() => {
    stop?.();
    stop = null;
    setAnalyticsSink(sentrySink);
    __resetAnalyticsSessionForTests();
  });

  /** Minimal nav-store stub: one immediate callback, like zustand's subscribe. */
  const subscribeOnce = (section: string) => (listener: (s: never, p: never) => void) => {
    const state = { sidebarSection: section } as never;
    listener(state, state);
    return () => {};
  };

  it('flushes one summary on pagehide', () => {
    stop = initAnalytics(subscribeOnce('overview'));
    window.dispatchEvent(new Event('pagehide'));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sectionsVisited).toContain('overview');
    expect(seen[0]!.sectionsIgnored.length).toBeGreaterThan(0);
  });

  it('emits exactly one summary when both teardown events fire', () => {
    stop = initAnalytics(subscribeOnce('overview'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));
    expect(seen).toHaveLength(1);
  });

  it('still flushes on beforeunload alone', () => {
    stop = initAnalytics(subscribeOnce('overview'));
    window.dispatchEvent(new Event('beforeunload'));
    expect(seen).toHaveLength(1);
  });

  it('emits nothing for a session that navigated nowhere', () => {
    stop = initAnalytics(() => () => {});
    window.dispatchEvent(new Event('pagehide'));
    expect(seen).toHaveLength(0);
  });
});
