// The "Strict queue order" switch, mirrored on LimitsDynamicBudgets.test.tsx
// beside it: same subsystem, same shape of control, so the same assertions.
//
// The one that matters is the DEFAULT. `fleet.strict_queue_order` defaults to
// FALSE (settings_keys.rs `FLEET_STRICT_QUEUE_ORDER_DEFAULT`) because off is
// today's door exactly; a control that rendered on by default would turn an
// opt-in into a silent behaviour change for every fleet.

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

describe('LimitsSettings: Strict queue order', () => {
  it('defaults OFF and writes fleet.strict_queue_order=true when switched on', async () => {
    render(<LimitsSettings />);
    const toggle = await screen.findByTestId('fleet-strict-queue-order-toggle');
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(setAppSetting).toHaveBeenCalledWith('fleet.strict_queue_order', 'true'),
    );
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('says out loud that a free slot can sit idle', async () => {
    // The hint is the only place the operator is told what the setting COSTS.
    // If it is ever rewritten into a neutral description, this fails.
    render(<LimitsSettings />);
    const row = await screen.findByTestId('fleet-strict-queue-order-row');
    expect(row.textContent).toMatch(/idle/i);
    expect(row.textContent).toMatch(/may not start/i);
  });
});
