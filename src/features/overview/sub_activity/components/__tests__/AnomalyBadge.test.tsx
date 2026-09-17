import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';
import { AnomalyBadge } from '../MetricsCards';

const anomaly: DashboardCostAnomaly = {
  date: '2026-09-15',
  cost: 42,
  moving_avg: 10.5,
  std_dev: 4,
  deviation_sigma: 3.2,
  execution_ids: ['abcdef0123456789'],
};

// Both click targets on this row used to be dead: the badge had no handler at
// all, and the execution ids rendered as <button>s whose `onClickExecution`
// was never passed from the Activity dashboard.
describe('AnomalyBadge click targets', () => {
  it('opens the drill-down when the spike line is clicked', () => {
    const onOpenDrilldown = vi.fn();
    render(<AnomalyBadge anomaly={anomaly} onOpenDrilldown={onOpenDrilldown} />);
    fireEvent.click(screen.getByRole('button', { name: /drill/i }));
    expect(onOpenDrilldown).toHaveBeenCalledTimes(1);
  });

  it('hands the execution id to the caller', () => {
    const onClickExecution = vi.fn();
    render(<AnomalyBadge anomaly={anomaly} onClickExecution={onClickExecution} />);
    fireEvent.click(screen.getByText('abcdef01'));
    expect(onClickExecution).toHaveBeenCalledWith('abcdef0123456789');
  });

  it('renders no dead controls when neither handler is wired', () => {
    render(<AnomalyBadge anomaly={anomaly} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // The ids are still readable — they just are not pretending to be clickable.
    expect(screen.getByText('abcdef01')).toBeTruthy();
  });
});
