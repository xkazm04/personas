import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const setAppSetting = vi.fn<(key: string, value: string) => Promise<void>>();
const getMetricsChartData = vi.fn();
const setMaxParallelExecutions = vi.fn();

vi.mock('@/api/system/settings', () => ({
  setAppSetting: (key: string, value: string) => setAppSetting(key, value),
  deleteAppSetting: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/hooks/utility/data/useSettings', () => ({
  getAppSettingCoalesced: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/api/overview/observability', () => ({
  getMetricsChartData: () => getMetricsChartData(),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (selector: (s: { setMaxParallelExecutions: typeof setMaxParallelExecutions }) => unknown) =>
    selector({ setMaxParallelExecutions }),
}));
vi.mock('@/features/settings/shared/RecentChangeChip', () => ({ RecentChangeChip: () => null }));

import LimitsSettings from '../LimitsSettings';

// invokeWithTimeout rejects with a serialized AppError, never an Error.
const appError = { error: 'database is locked', kind: 'internal' };

beforeEach(() => {
  setAppSetting.mockReset().mockResolvedValue(undefined);
  getMetricsChartData.mockReset().mockResolvedValue({ chart_points: [] });
  setMaxParallelExecutions.mockReset();
});

async function raiseConcurrencyAndSet() {
  render(<LimitsSettings />);
  await screen.findByRole('spinbutton', { name: 'Maximum parallel executions' });
  // The concurrency section renders first: its stepper and Set button lead.
  fireEvent.click(screen.getAllByRole('button', { name: /increase/i })[0]);
  fireEvent.click(screen.getAllByRole('button', { name: 'Set' })[0]);
  await waitFor(() => expect(setAppSetting).toHaveBeenCalledWith('max_parallel_executions', '11'));
}

describe('LimitsSettings failure surfaces', () => {
  it('names the spend-read failure instead of printing [object Object]', async () => {
    getMetricsChartData.mockRejectedValue(appError);
    render(<LimitsSettings />);
    // An unrecognised cause resolves to the registry's generic copy.
    await waitFor(() => expect(document.body.textContent).toContain('Something went wrong'));
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('does not push a refused concurrency cap into the live gauge', async () => {
    setAppSetting.mockRejectedValue(appError);
    await raiseConcurrencyAndSet();
    await new Promise((r) => setTimeout(r, 20));
    expect(setMaxParallelExecutions).not.toHaveBeenCalled();
  });

  it('pushes the cap into the live gauge once the write lands', async () => {
    await raiseConcurrencyAndSet();
    await waitFor(() => expect(setMaxParallelExecutions).toHaveBeenCalledWith(11));
  });
});
