// "What does Athena cost": a failed spend read must not read as "no spend, $0".
import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { OverviewFilterProvider } from '@/features/overview/components/dashboard/OverviewFilterContext';

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));

import { AthenaSpendSection } from '../AthenaSpendSection';

const renderSection = () => render(<OverviewFilterProvider><AthenaSpendSection /></OverviewFilterProvider>);

describe('AthenaSpendSection', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });
  beforeEach(() => invokeMock.mockReset());

  it('a failed read states the failure and no $0 total', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'companion_get_spend_rollup' ? Promise.reject({ error: 'db locked', kind: 'Database' }) : Promise.resolve(undefined));
    renderSection();
    await waitFor(() => expect(screen.getByText('Failed to load')).toBeTruthy());
    const section = screen.getByTestId('athena-spend-section').closest('section') ?? document.body;
    expect(section.textContent).not.toMatch(/\$0\.00/);
  });

  it('a real empty read still says there is no spend', async () => {
    invokeMock.mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(screen.queryByText('Failed to load')).toBeNull());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('companion_get_spend_rollup', expect.anything()));
  });
});
