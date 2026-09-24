// The Pipeline Ledger shell mounts over mocked data: the home ledger, a
// running contest opened in place, and a review contest in the split pane —
// plus the keys that walk between them.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from '../../../__tests__/fixtures';

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

import { useContestFocus } from '../../../focus';
import { __resetContestStoreForTests } from '../../../hooks/contestStore';
import PipelineLedgerShell from '../index';

const running = summaryFixture({ contestId: 'run-1', title: 'Pricing page', phase: 'running', updatedAtMs: 9 });
const review = summaryFixture({ contestId: 'hero-page', title: 'Hero page', phase: 'review', updatedAtMs: 5 });
const decided = summaryFixture({
  contestId: 'old',
  title: 'Old nav',
  phase: 'decided',
  winner: 'A/1',
  winnerSeatSpec: 'claude:claude-opus-5-5@xhigh',
  updatedAtMs: 1,
});

beforeEach(() => {
  __resetContestStoreForTests();
  useContestFocus.setState({ focused: null, focusSeq: 0, surface: 'ledger' });
  api.listContests.mockResolvedValue([running, review, decided]);
  api.getContestEnvironment.mockResolvedValue({
    node: true,
    instrumentPath: 'x',
    engines: { claude: true, codex: true, grok: true },
    playwright: true,
    problems: [],
  });
  api.getContest.mockImplementation(async (_p: string, id: string) => {
    if (id === 'run-1') {
      return detailFixture({
        summary: running,
        variants: [],
        chain: { step: 'idle', reason: null, updatedAtMs: null },
        seats: detailFixture().seats.map((s) => ({ ...s, state: 'running' as const })),
      });
    }
    return detailFixture({ summary: review });
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PipelineLedgerShell', () => {
  it('renders the home ledger with a stage rail per contest', async () => {
    render(<PipelineLedgerShell />);
    expect(await screen.findByTestId('ledger-row-p1/run-1')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-row-p1/hero-page')).toBeInTheDocument();
    expect(screen.getAllByTestId('ledger-stage-rail')).toHaveLength(3);
    // The decided contest names its winner and the seat that made it.
    expect(screen.getByText('A/1')).toBeInTheDocument();
  });

  it('opens a running contest in place with its seats and chain (j, Enter)', async () => {
    render(<PipelineLedgerShell />);
    await screen.findByTestId('ledger-row-p1/run-1');
    // The newest contest (running) is the first row; Enter opens it.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    expect(await screen.findByTestId('ledger-expanded-p1/run-1')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-seats')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-chain')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-cancel')).toBeInTheDocument();
    expect(useContestFocus.getState().focused).toEqual({ projectId: 'p1', contestId: 'run-1' });
    // j moves the cursor; Esc closes the row.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'j' });
    });
    expect(screen.getByTestId('ledger-row-p1/hero-page').querySelector('[data-cursor]')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(useContestFocus.getState().focused).toBeNull();
  });

  it('a focus from outside lands a review contest in the review split; 4 sorts a winner', async () => {
    render(<PipelineLedgerShell />);
    await screen.findByTestId('ledger-row-p1/hero-page');
    await act(async () => {
      useContestFocus.getState().focusContest({ projectId: 'p1', contestId: 'hero-page' });
    });
    expect(await screen.findByTestId('ledger-review')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-review-list')).toBeInTheDocument();
    expect(screen.getByTestId('contest-review-sheet-A/1')).toBeInTheDocument();
    expect(screen.getByTestId('contest-decide-winner')).toBeDisabled();
    await act(async () => {
      fireEvent.keyDown(window, { key: '4' });
    });
    expect(screen.getByTestId('contest-decide-winner')).not.toBeDisabled();
    // A key typed into the note stays in the note.
    const note = screen.getByTestId('contest-review-note-A/1');
    await act(async () => {
      fireEvent.keyDown(note, { key: '1' });
    });
    expect(screen.getByTestId('contest-decide-winner')).not.toBeDisabled();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('ledger-review')).not.toBeInTheDocument());
  });

  it('g shows the gains board', async () => {
    render(<PipelineLedgerShell />);
    await screen.findByTestId('ledger-row-p1/run-1');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'g' });
    });
    expect(await screen.findByTestId('ledger-gains')).toBeInTheDocument();
    expect(screen.getByTestId('contest-seat-stats')).toBeInTheDocument();
  });

  it('shows the error, not an empty ledger, when the list fails', async () => {
    api.listContests.mockRejectedValue(new Error('contest_list is not implemented yet'));
    render(<PipelineLedgerShell />);
    await waitFor(() => expect(api.listContests).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('The ledger is empty')).not.toBeInTheDocument());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
