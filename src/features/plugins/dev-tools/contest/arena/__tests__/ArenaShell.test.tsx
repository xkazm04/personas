// The Arena shell mounts over mocked hooks' api: the home column, a race on
// the track, and a review contest focused from outside (the live notice),
// which must open the photo finish.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from '../../__tests__/fixtures';

const api = vi.hoisted(() => ({
  listContests: vi.fn(),
  getContest: vi.fn(),
  getContestEnvironment: vi.fn(),
  getContestLineups: vi.fn(async () => []),
  setContestLineups: vi.fn(async () => null),
  saveContestReview: vi.fn(async () => null),
  createContest: vi.fn(),
  launchContest: vi.fn(async () => null),
  cancelContest: vi.fn(async () => null),
  decideContest: vi.fn(),
  runContestStep: vi.fn(async () => null),
  draftContestBrief: vi.fn(),
}));
vi.mock('@/api/contest', () => api);

import { focusContest, useContestFocus } from '../../focus';
import { __resetContestStoreForTests } from '../../hooks/contestStore';
import ArenaShell from '../index';
import { __resetArenaFocusForTests } from '../useArenaFocus';

const running = detailFixture({
  summary: summaryFixture({ contestId: 'race-1', title: 'Pricing page', phase: 'running' }),
  seats: [
    { ...detailFixture().seats[0]!, state: 'running', wallS: null, costUsd: null },
    { ...detailFixture().seats[1]!, state: 'queued', errors: [] },
  ],
  variants: [],
  chain: { step: 'idle', reason: null, updatedAtMs: null },
});
const review = detailFixture({ summary: summaryFixture({ contestId: 'hero-page', title: 'Hero page', phase: 'review' }) });

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
  api.listContests.mockResolvedValue([running.summary, review.summary]);
  api.getContest.mockImplementation(async (_p: string, c: string) => (c === 'race-1' ? running : review));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ArenaShell', () => {
  it('home: lists every race and puts the live one on the track', async () => {
    render(<ArenaShell />);
    const roster = await screen.findByTestId('arena-roster');
    expect(await within(roster).findByText('Pricing page')).toBeInTheDocument();
    expect(within(roster).getByText('Hero page')).toBeInTheDocument();
    expect(screen.getByTestId('arena-new-race')).toBeInTheDocument();
    // No focus: the newest live race is on the track, one lane per seat.
    expect(await screen.findByTestId('arena-track')).toBeInTheDocument();
    expect(screen.getByTestId('arena-lane-claude-claude-opus-5-5_xhigh')).toBeInTheDocument();
    expect(screen.getByTestId('arena-lane-codex-gpt-6-sol_high')).toBeInTheDocument();
  });

  it('running: lanes show the race stage and the finish line waits', async () => {
    render(<ArenaShell />);
    await screen.findByTestId('arena-track');
    const stages = screen.getAllByTestId('arena-lane-track').map((el) => el.getAttribute('data-stage'));
    expect(stages).toEqual(['racing', 'grid']);
    expect(screen.getByTestId('arena-station-collect')).toHaveAttribute('data-status', 'pending');
    expect(screen.getByTestId('arena-cancel')).toBeInTheDocument();
  });

  it('review: an outside focus opens the photo finish, and a slot sorts the variant', async () => {
    render(<ArenaShell />);
    await screen.findByTestId('arena-track');
    act(() => focusContest({ projectId: 'p1', contestId: 'hero-page' }));
    const lightbox = await screen.findByTestId('arena-photo-finish');
    expect(within(lightbox).getByTestId('contest-review-sheet-A/1')).toBeInTheDocument();
    expect(within(lightbox).getByTestId('arena-filmstrip')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(lightbox).getByTestId('arena-tray-move-winner'));
    });
    await waitFor(() => expect(within(screen.getByTestId('arena-tray-winner')).getByText('A/1')).toBeInTheDocument());
    expect(screen.getByTestId('contest-decide-winner')).not.toBeDisabled();
  });

  it('a roster pick moves the track without opening the lightbox', async () => {
    render(<ArenaShell />);
    const roster = await screen.findByTestId('arena-roster');
    await within(roster).findByText('Hero page');
    fireEvent.click(screen.getByTestId('arena-race-hero-page'));
    await waitFor(() => expect(screen.getByTestId('arena-open-photo-finish')).toBeInTheDocument());
    expect(screen.queryByTestId('arena-photo-finish')).not.toBeInTheDocument();
  });
});
