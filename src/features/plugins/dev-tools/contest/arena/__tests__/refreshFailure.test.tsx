// A refetch that fails behind rendered data says so (note a): the Arena keeps
// the last good rows but shows a quiet "couldn't refresh" line with a retry,
// instead of looking live while frozen.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from '../../__tests__/fixtures';

const api = vi.hoisted(() => ({
  listContests: vi.fn(),
  getContest: vi.fn(),
  getContestEnvironment: vi.fn(),
  getContestLineups: vi.fn(async () => []),
  saveContestReview: vi.fn(async () => null),
}));
vi.mock('@/api/contest', () => api);

import { useContestFocus } from '../../focus';
import { __resetContestStoreForTests, refreshContest, refreshContests } from '../../hooks/contestStore';
import ArenaShell from '../index';
import { __resetArenaFocusForTests } from '../useArenaFocus';

const running = detailFixture({ summary: summaryFixture({ contestId: 'race-1', title: 'Live race', phase: 'running' }), variants: [] });

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  __resetContestStoreForTests();
  __resetArenaFocusForTests();
  useContestFocus.setState({ focused: null, focusSeq: 0 });
  api.getContestEnvironment.mockResolvedValue({ node: true, instrumentPath: 'x', engines: { claude: true, codex: true, grok: true }, playwright: true, problems: [] });
  api.listContests.mockResolvedValue([running.summary]);
  api.getContest.mockResolvedValue(running);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('refresh failure behind shown data', () => {
  it('the roster keeps its rows and says it could not refresh; Retry re-lists', async () => {
    render(<ArenaShell />);
    await screen.findByTestId('arena-race-race-1');
    api.listContests.mockRejectedValueOnce(new Error('database is locked'));
    await act(async () => {
      await refreshContests();
    });
    expect(screen.getByTestId('arena-race-race-1')).toBeInTheDocument();
    const line = screen.getByTestId('arena-roster-refresh-failed');
    api.listContests.mockResolvedValue([running.summary]);
    await act(async () => {
      fireEvent.click(line.querySelector('button')!);
    });
    await waitFor(() => expect(screen.queryByTestId('arena-roster-refresh-failed')).toBeNull());
  });

  it('the track keeps the race and says it could not refresh', async () => {
    render(<ArenaShell />);
    await screen.findByTestId('arena-track');
    api.getContest.mockRejectedValueOnce(new Error('database is locked'));
    await act(async () => {
      await refreshContest('p1', 'race-1');
    });
    expect(screen.getByTestId('arena-track')).toBeInTheDocument();
    expect(screen.getByTestId('arena-track-refresh-failed')).toBeInTheDocument();
  });
});
