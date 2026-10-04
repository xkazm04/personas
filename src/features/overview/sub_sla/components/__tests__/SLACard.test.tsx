import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyTrendChart } from '../SLACard';

/** Thirty days, the shape Mission Control actually passes. */
const points = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  success_rate: i === 7 ? 0 : 0.8 + (i % 5) * 0.04,
  total: 10 + i,
}));

/**
 * Regression guard for a defect this chart has shipped TWICE (see the comment on
 * `trendBarHeight` in `../SLACard.tsx`): every bar painting at 0px.
 *
 * jsdom computes no layout, and `src/test/setup.ts` additionally stubs
 * `offsetHeight` to a constant 600 for every element — so a measured-height
 * assertion here would not merely be blind, it would read 600 for a bar that
 * paints at 0px in the browser. What jsdom DOES preserve is the inline style,
 * and that is exactly where
 * both recurrences lived — the first had no `height` at all, the second had
 * `height: <pct>%`, which is unresolvable because each bar's parent column is an
 * auto-height flex item in an `items-end` row. So the assertion is: the height
 * is an ABSOLUTE length and it is greater than zero. A percentage fails it, a
 * missing height fails it, and either is the bug.
 */
describe('DailyTrendChart bar geometry', () => {
  it('gives every bar a non-zero absolute pixel height', () => {
    render(<DailyTrendChart points={points} />);
    const bars = screen.getAllByTestId('sla-trend-bar');
    expect(bars).toHaveLength(30);

    for (const bar of bars) {
      const h = bar.style.height;
      // An absolute length only: a percentage cannot resolve against this parent.
      expect(h).toMatch(/^\d+(\.\d+)?px$/);
      expect(parseFloat(h)).toBeGreaterThan(0);
    }
  });

  it('scales the bar with the success rate and floors a zero-rate day', () => {
    render(<DailyTrendChart points={points} />);
    const bars = screen.getAllByTestId('sla-trend-bar');

    // Day 8 is the 0% day: still a visible sliver, and the shortest bar.
    const zeroDay = parseFloat(bars[7].style.height);
    expect(zeroDay).toBeGreaterThan(0);
    expect(zeroDay).toBe(Math.min(...bars.map((b) => parseFloat(b.style.height))));

    // A 100% day fills the plot; the strip is sized from the same constant.
    render(<DailyTrendChart points={[{ date: '2026-10-01', success_rate: 1, total: 4 }]} />);
    const full = screen.getAllByTestId('sla-trend-bar').at(-1)!;
    expect(parseFloat(full.style.height)).toBe(96);
  });

  it('clamps an out-of-range rate instead of overflowing the plot', () => {
    render(<DailyTrendChart points={[{ date: '2026-10-01', success_rate: 1.4, total: 4 }]} />);
    expect(parseFloat(screen.getByTestId('sla-trend-bar').style.height)).toBe(96);
  });

  it('renders nothing when there are no points', () => {
    const { container } = render(<DailyTrendChart points={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
