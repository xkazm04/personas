import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const setPresetFlowOpen = vi.fn();

vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setPresetFlowOpen }),
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { pipeline: { preset_team: 'Preset team', auto_team: 'Auto-team' } },
    tx: (s: string) => s,
  }),
}));

// The modal drags the whole auto-team pipeline (IPC, blueprint preview) in.
// Only its open/closed contract matters here.
const autoTeamOpen = vi.fn();
vi.mock('../../AutoTeamModal', () => ({
  AutoTeamModal: ({ open }: { open: boolean }) => {
    autoTeamOpen(open);
    return open ? <div data-testid="auto-team-modal" /> : null;
  },
}));

import { TeamCreateActions } from '../TeamCreateActions';

describe('TeamCreateActions', () => {
  beforeEach(() => {
    setPresetFlowOpen.mockClear();
    autoTeamOpen.mockClear();
  });

  it('opens the preset flow (the only live caller of setPresetFlowOpen)', () => {
    render(<TeamCreateActions />);
    fireEvent.click(screen.getByTestId('team-preset-btn'));
    expect(setPresetFlowOpen).toHaveBeenCalledWith(true);
  });

  it('mounts AutoTeamModal closed and opens it from the header', () => {
    render(<TeamCreateActions />);
    expect(screen.queryByTestId('auto-team-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('team-auto-btn'));
    expect(screen.getByTestId('auto-team-modal')).toBeTruthy();
  });
});
