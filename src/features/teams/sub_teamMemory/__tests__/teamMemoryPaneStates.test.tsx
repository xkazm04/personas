import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/pipeline/teamMemories', () => ({
  listTeamMemories: vi.fn(),
  getTeamMemoryCount: vi.fn().mockResolvedValue(0),
  getTeamMemoryStats: vi.fn().mockResolvedValue(null),
  createTeamMemory: vi.fn(),
  deleteTeamMemory: vi.fn(),
  updateTeamMemory: vi.fn(),
  updateTeamMemoryImportance: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ trackInteraction: vi.fn() }));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import * as api from '@/api/pipeline/teamMemories';
import { TeamMemoryPane } from '../TeamMemoryPane';

const EMPTY_COPY = en.pipeline.no_memories_yet;

describe('TeamMemoryPane: loading, failed and empty are three states', () => {
  beforeEach(() => {
    vi.mocked(api.listTeamMemories).mockReset();
  });

  it('loading paints a ghost, never the empty copy', async () => {
    // A fetch that never settles: the first paint must not claim emptiness.
    vi.mocked(api.listTeamMemories).mockReturnValue(new Promise(() => {}));
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);

    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByTestId('memory-load-failed')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('a settled empty list paints the empty copy', async () => {
    vi.mocked(api.listTeamMemories).mockResolvedValue([]);
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(EMPTY_COPY)).toBeTruthy());
    expect(screen.queryByTestId('memory-load-failed')).toBeNull();
  });

  it('a rejected fetch paints a retry, never the empty copy', async () => {
    vi.mocked(api.listTeamMemories).mockRejectedValue(new Error('ipc down'));
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('memory-load-failed')).toBeTruthy());
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it('retry re-issues the fetch and recovers into the empty state', async () => {
    vi.mocked(api.listTeamMemories)
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValue([]);
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('memory-load-failed')).toBeTruthy());
    fireEvent.click(screen.getByText(en.common.retry));
    await waitFor(() => expect(screen.getByText(EMPTY_COPY)).toBeTruthy());
    expect(screen.queryByTestId('memory-load-failed')).toBeNull();
  });
});
