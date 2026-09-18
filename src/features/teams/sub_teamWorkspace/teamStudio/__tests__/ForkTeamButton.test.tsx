import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const cloneTeam = vi.fn();
const selectTeam = vi.fn();

vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ cloneTeam, selectTeam }),
}));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { ForkTeamButton } from '../ForkTeamButton';

describe('ForkTeamButton', () => {
  beforeEach(() => {
    cloneTeam.mockReset();
    selectTeam.mockReset();
  });

  it('forks the team and selects the copy', async () => {
    cloneTeam.mockResolvedValue({ id: 'copy-1', name: 'Core (copy)' });
    render(<ForkTeamButton teamId="t1" />);

    fireEvent.click(screen.getByTestId('team-fork-btn'));
    await waitFor(() => expect(cloneTeam).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(selectTeam).toHaveBeenCalledWith('copy-1'));
  });

  it('selects nothing when the store reports the fork failed', async () => {
    // The store swallows the error into its own channel and returns null.
    cloneTeam.mockResolvedValue(null);
    render(<ForkTeamButton teamId="t1" />);

    fireEvent.click(screen.getByTestId('team-fork-btn'));
    await waitFor(() => expect(cloneTeam).toHaveBeenCalledTimes(1));
    expect(selectTeam).not.toHaveBeenCalled();
  });
});
