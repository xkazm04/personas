import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

// IPC rejects with a serialized AppError OBJECT, never an Error.
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((cmd: string) =>
    cmd === 'list_memories_with_stats'
      ? Promise.reject({ error: 'database is locked', kind: 'Database' })
      : Promise.resolve([]),
  ),
}));

import { useOverviewStore } from '@/stores/overviewStore';
import { __resetResolvedConflicts } from '../../libs/memoryConflicts';
import { MemoryConflictReview } from '../MemoryConflictReview';
import MemoriesPageDense from '../MemoriesPageDense';

describe('memories surfaces never paint a failed read as empty', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview', 'debt']);
  });

  beforeEach(() => {
    __resetResolvedConflicts();
    useOverviewStore.setState({ memories: [], memoriesTotal: 0, memoriesLoading: false, memoriesError: null });
  });

  it('the conflict audit does not certify "all conflicts resolved" over a failed read', () => {
    useOverviewStore.setState({ memories: [], memoriesTotal: 0, memoriesError: 'database is locked' });
    render(<MemoryConflictReview />);
    expect(screen.queryByText('All conflicts resolved')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('the memories list shows the failure, not "No memories yet"', async () => {
    render(<MemoriesPageDense />);
    await waitFor(() => expect(useOverviewStore.getState().memoriesError).not.toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('No memories yet')).toBeNull();
  });
});
