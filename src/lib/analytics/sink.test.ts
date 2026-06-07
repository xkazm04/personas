import { describe, it, expect, afterEach } from 'vitest';
import {
  getAnalyticsSink,
  setAnalyticsSink,
  applyTelemetrySink,
  sentrySink,
  noopSink,
} from './sink';

// Always restore the default so test order can't leak the active sink.
afterEach(() => setAnalyticsSink(sentrySink));

describe('analytics sink registry', () => {
  it('defaults to sentrySink', () => {
    expect(getAnalyticsSink()).toBe(sentrySink);
  });

  it('setAnalyticsSink swaps the active sink', () => {
    setAnalyticsSink(noopSink);
    expect(getAnalyticsSink()).toBe(noopSink);
  });

  it('applyTelemetrySink(false) routes to noopSink and (true) restores sentrySink', () => {
    applyTelemetrySink(false);
    expect(getAnalyticsSink()).toBe(noopSink);

    applyTelemetrySink(true);
    expect(getAnalyticsSink()).toBe(sentrySink);
  });

  it('noopSink swallows every event without throwing', () => {
    expect(() => {
      noopSink.feature({ section: 'overview', action: 'view' });
      noopSink.interaction({ category: 'persona', action: 'create' });
      noopSink.session({
        counts: {},
        totalVisits: 0,
        sectionsVisited: [],
        sectionsIgnored: [],
        sectionsTotal: 0,
        tabsVisited: [],
        tabsIgnored: [],
        tabsTotal: 0,
      });
    }).not.toThrow();
  });
});
