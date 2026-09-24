import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const setAppSetting = vi.fn<(key: string, value: string) => Promise<void>>();
vi.mock('@/api/system/settings', () => ({
  setAppSetting: (key: string, value: string) => setAppSetting(key, value),
  deleteAppSetting: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/hooks/utility/data/useSettings', () => ({
  getAppSettingCoalesced: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/api/overview/observability', () => ({
  getMetricsChartData: vi.fn().mockResolvedValue({ chart_points: [] }),
}));
vi.mock('@/features/settings/shared/RecentChangeChip', () => ({ RecentChangeChip: () => null }));

import LimitsSettings from '../LimitsSettings';

beforeEach(() => {
  setAppSetting.mockReset();
  setAppSetting.mockResolvedValue(undefined);
});

describe('LimitsSettings: Dynamic fleet budgets', () => {
  it('defaults on and writes fleet.dynamic_budgets=false when switched off', async () => {
    render(<LimitsSettings />);
    const toggle = await screen.findByTestId('fleet-dynamic-budgets-toggle');
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(setAppSetting).toHaveBeenCalledWith('fleet.dynamic_budgets', 'false'));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });
});
