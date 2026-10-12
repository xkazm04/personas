import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/system/settings', () => ({
  setAppSetting: vi.fn().mockResolvedValue(undefined),
  deleteAppSetting: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(null),
}));
// Every stored-limit read rejects (IPC timeout during boot contention).
vi.mock('@/hooks/utility/data/useSettings', () => ({
  getAppSettingCoalesced: vi.fn().mockRejectedValue(new Error('ipc timeout')),
}));
vi.mock('@/api/overview/observability', () => ({
  getMetricsChartData: vi.fn().mockResolvedValue({ chart_points: [] }),
}));
vi.mock('@/features/settings/shared/RecentChangeChip', () => ({ RecentChangeChip: () => null }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => undefined }));

import LimitsSettings from '../LimitsSettings';

describe('LimitsSettings: failed limit read', () => {
  it('flags ceiling, concurrency and roster as unread instead of showing defaults as stored', async () => {
    render(<LimitsSettings />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(3);
  });
});
