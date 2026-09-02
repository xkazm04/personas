/**
 * An UNMEASURED duration was painted as a regression.
 *
 * `ExecutionComparison` passed `left.duration_ms ?? 0` into `MetricDeltaCard`,
 * whose `pctChange` hardcodes `a === 0 -> 100`. So a run whose duration was
 * never recorded rendered "+100%" beside an amber TrendingUp — an invented
 * regression, indistinguishable on screen from a real one.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricDeltaCard } from '../ComparisonMetrics';

const fmt = (v: number) => `${v}ms`;

describe('MetricDeltaCard', () => {
  it('renders an em dash and NO delta when a value was never measured', () => {
    render(<MetricDeltaCard label="duration" leftVal={null} rightVal={500} format={fmt} />);
    expect(screen.queryByText('+100%')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('500ms')).toBeTruthy();
  });

  it('still renders the delta when both sides are measured', () => {
    render(<MetricDeltaCard label="duration" leftVal={100} rightVal={200} format={fmt} />);
    expect(screen.getByText('+100%')).toBeTruthy();
  });

  it('reads a measured zero as a measurement, not an absence', () => {
    render(<MetricDeltaCard label="cost" leftVal={0} rightVal={0} format={(v) => `${v}`} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });
});
