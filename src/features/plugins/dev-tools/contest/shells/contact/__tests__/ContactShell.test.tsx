// The Contact Sheet shell mounts with mocked hooks/api: the light table (home),
// a running roll (developing trays), a review roll (the loupe), and the
// keepers view; the grease-pencil keys mark a frame.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from '../../../__tests__/fixtures';

const api = vi.hoisted(() => ({
  listContests: vi.fn(),
  getContest: vi.fn(),
  getContestEnvironment: vi.fn(),
  getContestLineups: vi.fn(),
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

import ContactSheetShell from '../index';
import { useContestFocus } from '../../../focus';
import { __resetContestStoreForTests } from '../../../hooks/contestStore';

const review = summaryFixture();
const running = summaryFixture({ contestId: 'dash', title: 'Dashboard', phase: 'running' });
const decided = summaryFixture({
  contestId: 'old',
  title: 'Old roll',
  phase: 'decided',
  winner: 'A/1',
  winnerSeatSpec: 'claude:claude-opus-5-5@xhigh',
});
const child = summaryFixture({ contestId: 'hero-r2', title: 'Hero page r2', parentId: 'hero-page', round: 2, phase: 'draft' });

const runningDetail = detailFixture({
  summary: running,
  variants: [],
  chain: { step: 'idle', reason: null, updatedAtMs: null },
  seats: detailFixture().seats.map((s, i) => ({ ...s, state: i === 0 ? 'running' : 'queued', letter: null })),
});

beforeEach(() => {
  __resetContestStoreForTests();
  useContestFocus.setState({ focused: null, focusSeq: 0, surface: 'contact' });
  api.listContests.mockResolvedValue([review, child, running, decided]);
  api.getContest.mockImplementation(async (_p: string, id: string) => {
    if (id === 'dash') return runningDetail;
    if (id === 'old') return detailFixture({ summary: decided });
    if (id === 'hero-r2') return detailFixture({ summary: child, variants: [] });
    return detailFixture();
  });
  api.getContestEnvironment.mockResolvedValue({
    node: true,
    instrumentPath: 'x',
    engines: { claude: true, codex: true, grok: true },
    playwright: true,
    problems: [],
  });
  api.getContestLineups.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContactSheetShell', () => {
  it('lays every roll on the light table, rounds nested, frames and marks shown', async () => {
    render(<ContactSheetShell />);
    expect(await screen.findByTestId('contact-wall')).toBeInTheDocument();
    expect(screen.getByTestId('contact-strip-hero-page')).toBeInTheDocument();
    expect(screen.getByTestId('contact-strip-hero-r2')).toBeInTheDocument();
    // A reviewed roll shows its frames; the kept frame of a decided roll wears the star.
    expect(await screen.findAllByTestId('contact-frame-A/1')).not.toHaveLength(0);
    expect(await screen.findByTestId('contact-strip-kept-old')).toBeInTheDocument();
    // A running roll shows its seats developing, with their spec.
    await waitFor(() => expect(screen.getByTestId('contact-strip-dash')).toHaveTextContent('gpt-6-sol'));
  });

  it('opens a running roll on its developing trays', async () => {
    render(<ContactSheetShell />);
    fireEvent.click(await screen.findByTestId('contact-strip-open-dash'));
    expect(useContestFocus.getState().focused).toEqual({ projectId: 'p1', contestId: 'dash' });
    expect(await screen.findByTestId('contact-developing')).toBeInTheDocument();
    expect(screen.getByTestId('contact-tray-claude-claude-opus-5-5_xhigh')).toBeInTheDocument();
    expect(screen.getByTestId('contact-chain-rail')).toBeInTheDocument();
  });

  it('opens a review roll on the loupe and marks a frame with the grease pencil', async () => {
    useContestFocus.setState({ focused: { projectId: 'p1', contestId: 'hero-page' }, focusSeq: 1 });
    render(<ContactSheetShell />);
    expect(await screen.findByTestId('contact-loupe')).toBeInTheDocument();
    expect(screen.getByTestId('contact-filmstrip')).toBeInTheDocument();
    expect(screen.getByTestId('contest-decide-winner')).toBeDisabled();
    // The typed glyph marks the frame on the loupe (A/1) as the winner.
    await act(async () => {
      fireEvent.keyDown(window, { key: '*' });
    });
    expect(screen.getByTestId('contest-decide-winner')).not.toBeDisabled();
    expect(screen.getByTestId('contact-sort-winner')).toHaveTextContent('A/1');
    // → moves to the next frame; blind seats stay hidden until unmasked.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByTestId('contest-review-sheet-B/1')).toBeInTheDocument();
    expect(screen.getByTestId('contact-made-by')).not.toHaveTextContent('gpt-6-sol');
    // Escape goes back to the light table.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(useContestFocus.getState().focused).toBeNull();
  });

  it('shows the kept prints with the seat that made them', async () => {
    render(<ContactSheetShell />);
    fireEvent.click(await screen.findByTestId('contact-view-keepers'));
    expect(await screen.findByTestId('contact-keepers')).toBeInTheDocument();
    expect(screen.getByTestId('contact-keeper-old')).toHaveTextContent('A/1');
    expect(screen.getByTestId('contest-seat-stats')).toBeInTheDocument();
  });

  it('says so when the list cannot load, instead of an empty table', async () => {
    api.listContests.mockRejectedValue(new Error('contest_list is not implemented yet'));
    render(<ContactSheetShell />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('The light table is empty')).not.toBeInTheDocument();
  });
});
