/**
 * Growth from a zero base is not a percentage. `generateWhatChanged` refuses
 * it (both sides must be > 0); the metric card must refuse it too instead of
 * painting "+100%" beside an amber TrendingUp.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricDeltaCard } from '../ComparisonMetrics';

describe('MetricDeltaCard zero base', () => {
  it('renders no percentage for 0 -> N', () => {
    render(<MetricDeltaCard label="tokens" leftVal={0} rightVal={4000} format={(v) => `${v}`} />);
    expect(screen.queryByText('+100%')).toBeNull();
    expect(screen.getAllByText('—').length).toBe(1);
  });

  it('keeps 0 -> 0 as 0%', () => {
    render(<MetricDeltaCard label="tokens" leftVal={0} rightVal={0} format={(v) => `${v}`} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });
});
