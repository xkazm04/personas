// Every live Arena control that calls the backend asserts WHICH call it makes
// (FE-7): launch, stop, lane rerun (participant and judge), chain retry, and the
// verdict. These are the paid, irreversible parts of the page.
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

import type { ContestDetail } from '@/lib/bindings/ContestDetail';

import { focusContest, useContestFocus } from '../../focus';
import { __resetContestStoreForTests } from '../../hooks/contestStore';
import ArenaShell from '../index';
import { __resetArenaFocusForTests } from '../useArenaFocus';

const base = detailFixture();
const withId = (contestId: string, over: Partial<ContestDetail>): ContestDetail =>
  detailFixture({ ...over, summary: summaryFixture({ contestId, title: contestId, ...(over.summary ?? {}) }) });

const draft = withId('draft-1', { summary: summaryFixture({ contestId: 'draft-1', title: 'Draft race', phase: 'draft' }), variants: [] });
const running = withId('race-1', {
  summary: summaryFixture({ contestId: 'race-1', title: 'Live race', phase: 'running' }),
  seats: [{ ...base.seats[0]!, state: 'running' }, { ...base.seats[1]!, state: 'queued', errors: [] }],
  variants: [],
  chain: { step: 'idle', reason: null, updatedAtMs: null },
});
const failed = withId('broken-1', {
  summary: summaryFixture({ contestId: 'broken-1', title: 'Broken race', phase: 'failed' }),
  judgesEnabled: true,
  seats: [
    base.seats[0]!,
    base.seats[1]!,
    { ...base.seats[0]!, seatId: 'claude-judge_high', spec: 'claude:claude-opus-5-5@high', kind: 'judge', state: 'errored', letter: null },
  ],
  chain: { step: 'failed', reason: 'collect: 0 of 2 seats delivered a variant', updatedAtMs: null },
});
const review = withId('hero-page', { summary: summaryFixture({ contestId: 'hero-page', title: 'Review race', phase: 'review' }) });
const all = [draft, running, failed, review];

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
  api.listContests.mockResolvedValue(all.map((d) => d.summary));
  api.getContest.mockImplementation(async (_p: string, c: string) => all.find((d) => d.summary.contestId === c)!);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function onTrack(contestId: string, title: string) {
  render(<ArenaShell />);
  await screen.findByTestId('arena-roster');
  act(() => focusContest({ projectId: 'p1', contestId }));
  await waitFor(() => expect(within(screen.getByTestId('arena-track')).getByRole('heading', { name: title })).toBeInTheDocument());
}

describe('Arena controls call the backend they name', () => {
  it('Start the race launches the participants of that contest', async () => {
    await onTrack('draft-1', 'Draft race');
    await act(async () => {
      fireEvent.click(screen.getByTestId('arena-launch'));
    });
    expect(api.launchContest).toHaveBeenCalledWith('p1', 'draft-1', 'participant');
  });

  it('Stop the race cancels only after the confirm', async () => {
    await onTrack('race-1', 'Live race');
    fireEvent.click(screen.getByTestId('arena-cancel'));
    expect(api.cancelContest).not.toHaveBeenCalled();
    const dialog = (await screen.findAllByRole('dialog')).at(-1)!;
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Stop the race' }));
    });
    expect(api.cancelContest).toHaveBeenCalledWith('p1', 'race-1');
  });

  it('a lane rerun relaunches exactly that seat, with its own kind', async () => {
    await onTrack('broken-1', 'Broken race');
    await act(async () => {
      fireEvent.click(screen.getByTestId('arena-lane-rerun-codex-gpt-6-sol_high'));
    });
    expect(api.launchContest).toHaveBeenLastCalledWith('p1', 'broken-1', 'participant', ['codex-gpt-6-sol_high']);
    await act(async () => {
      fireEvent.click(screen.getByTestId('arena-lane-rerun-claude-judge_high'));
    });
    expect(api.launchContest).toHaveBeenLastCalledWith('p1', 'broken-1', 'judge', ['claude-judge_high']);
  });

  it('a chain retry runs the step it names', async () => {
    await onTrack('broken-1', 'Broken race');
    await act(async () => {
      fireEvent.click(screen.getByTestId('arena-retry-collect'));
    });
    expect(api.runContestStep).toHaveBeenCalledWith('p1', 'broken-1', 'collect');
  });

  it('Declare winner sends the sorted winner', async () => {
    api.decideContest.mockResolvedValue(summaryFixture({ contestId: 'hero-page', phase: 'decided', winner: 'A/1' }));
    render(<ArenaShell />);
    await screen.findByTestId('arena-roster');
    act(() => focusContest({ projectId: 'p1', contestId: 'hero-page' }));
    const lightbox = await screen.findByTestId('arena-photo-finish');
    await act(async () => {
      fireEvent.click(within(lightbox).getByTestId('arena-tray-move-winner'));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId('contest-decide-winner'));
    });
    const dialog = (await screen.findAllByRole('dialog')).at(-1)!;
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Declare winner' }));
    });
    expect(api.decideContest).toHaveBeenCalledWith('p1', 'hero-page', expect.objectContaining({ kind: 'winner', winner: 'A/1', runnerUp: null }));
  });
});
