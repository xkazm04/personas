import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DailyBreakdownChart } from './DailyBreakdownChart';

/**
 * Per-day values used to live only in a mouse-hover tooltip. The chart now
 * carries a visually hidden table with the same figures, one row per day.
 */
describe('DailyBreakdownChart accessible data', () => {
  it('exposes every day as a table row without hovering', () => {
    render(
      <DailyBreakdownChart
        data={[
          { date: '2026-08-01', count: 12, cost: 0.5, success_rate: 0.9 },
          { date: '2026-08-02', count: 3, cost: 0.1, success_rate: null },
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Daily executions' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Runs', 'Cost', 'Success']);
    const day1 = within(table).getByRole('rowheader', { name: '2026-08-01' }).closest('tr')!;
    expect(within(day1).getByText('12')).toBeTruthy();
    const day2 = within(table).getByRole('rowheader', { name: '2026-08-02' }).closest('tr')!;
    expect(within(day2).getByText('-')).toBeTruthy();
  });
});
