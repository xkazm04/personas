// A line-up save never shrinks the saved set it could not read (FE-9), and the
// bar tells loading, failed and empty apart.
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listContests: vi.fn(),
  getContest: vi.fn(),
  getContestEnvironment: vi.fn(),
  getContestLineups: vi.fn(),
  setContestLineups: vi.fn(async () => null),
}));
vi.mock('@/api/contest', () => api);

import { LineupBar } from '../components/LineupBar';
import { __resetContestStoreForTests } from '../hooks/contestStore';
import { useContestLineups } from '../hooks/useContestLineups';

const nightly = { name: 'Nightly', seats: ['claude:claude-opus-5-5@xhigh'] };
const saved = [
  { name: 'Frontier', seats: ['claude:claude-opus-5-5@xhigh'] },
  { name: 'Budget', seats: ['codex:gpt-6-sol@high'] },
];

beforeEach(() => {
  __resetContestStoreForTests();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('useContestLineups', () => {
  it('refuses to write when the saved line-ups could not be read', async () => {
    api.getContestLineups.mockRejectedValue(new Error('database is locked'));
    const { result } = renderHook(() => useContestLineups());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await act(async () => {
      await expect(result.current.upsert(nightly)).rejects.toBeTruthy();
    });
    expect(api.setContestLineups).not.toHaveBeenCalled();
  });

  it('a save before the first read settles keeps every saved line-up', async () => {
    let release!: (v: typeof saved) => void;
    api.getContestLineups.mockReturnValueOnce(new Promise((r) => { release = r; })).mockResolvedValue(saved);
    const { result } = renderHook(() => useContestLineups());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.upsert(nightly);
    });
    release(saved);
    await act(async () => {
      await pending;
    });
    expect(api.setContestLineups).toHaveBeenCalledWith([...saved, nightly]);
  });
});

describe('LineupBar states', () => {
  it('a failed read is not "No saved line-ups yet"', async () => {
    api.getContestLineups.mockRejectedValue(new Error('database is locked'));
    render(<LineupBar panel={[]} onApply={() => {}} testIdPrefix="lu" />);
    expect(await screen.findByTestId('lu-error')).toBeInTheDocument();
    expect(screen.queryByText('No saved line-ups yet.')).toBeNull();
  });

  it('an empty read says so', async () => {
    api.getContestLineups.mockResolvedValue([]);
    render(<LineupBar panel={[]} onApply={() => {}} testIdPrefix="lu" />);
    expect(await screen.findByText('No saved line-ups yet.')).toBeInTheDocument();
  });
});
