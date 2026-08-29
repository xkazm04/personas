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

  it('the analytics surface routes trackInteraction through the active sink, not straight to Sentry', async () => {
    const { trackInteraction } = await import('./index');
    const seen: Array<{ category: string; action: string }> = [];
    setAnalyticsSink({ ...noopSink, interaction: (e) => seen.push(e) });
    trackInteraction('persona', 'create', 'from_template');
    expect(seen).toEqual([{ category: 'persona', action: 'create', label: 'from_template' }]);

    // Telemetry off: the same call site emits nothing, with no branch of its own.
    setAnalyticsSink(noopSink);
    trackInteraction('persona', 'create');
    expect(seen).toHaveLength(1);
  });

  it('noopSink swallows every event without throwing', () => {
    expect(() => {
      noopSink.feature({ section: 'overview', action: 'view' });
      noopSink.interaction({ category: 'persona', action: 'create' });
      noopSink.conversion({ step: 'persona_created', ordinal: 2, installId: 'x' });
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
