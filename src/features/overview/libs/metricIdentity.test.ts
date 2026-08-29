import { describe, it, expect } from 'vitest';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from './metricIdentity';

/**
 * The collapse this guards is upstream of every chart and tile: a derivation
 * that returns 0 for an empty denominator has decided "not measured" is
 * "measured, zero" before any surface gets a vote. A displayable metric is
 * "number, or explicitly absent" all the way from derivation to pixel.
 */
describe('resolveMetricPercent', () => {
  it('resolves a real ratio', () => {
    expect(resolveMetricPercent(SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: 19, denominator: 20 })).toBe(95);
    expect(resolveMetricPercent(SUCCESS_RATE_IDENTITIES.executionDashboardSummary,
      { ratio: 0.5 })).toBe(50);
  });

  it('reports a measured zero as zero', () => {
    expect(resolveMetricPercent(SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: 0, denominator: 20 })).toBe(0);
  });

  it('reports an unmeasured window as absent, not as zero', () => {
    // Nothing ran in the window. A fleet that executed nothing did not have a
    // 0% success rate; it had no success rate.
    expect(resolveMetricPercent(SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: 0, denominator: 0 })).toBeNull();
    expect(resolveMetricPercent(SUCCESS_RATE_IDENTITIES.executionDashboardSummary,
      {})).toBeNull();
  });

  it('reports an unreadable input as absent, not as zero', () => {
    expect(resolveMetricPercent(SUCCESS_RATE_IDENTITIES.executionDashboardSummary,
      { ratio: NaN })).toBeNull();
  });
});
