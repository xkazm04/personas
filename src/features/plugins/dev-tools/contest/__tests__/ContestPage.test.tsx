// The page and the shared components mount without a runtime error — both
// while the backend still answers "not implemented" and with real data.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from './fixtures';

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

import ContestPage from '../ContestPage';
import { DecisionBar } from '../components/DecisionBar';
import { ReviewSheet, FieldNoteEditor } from '../components/ReviewSheet';
import { RunBoard } from '../components/RunBoard';
import { SeatStatsBoard } from '../components/SeatStatsBoard';
import { VariantFrame } from '../components/VariantFrame';
import { useContestFocus } from '../focus';
import { __resetContestStoreForTests } from '../hooks/contestStore';
import { useReviewDraft } from '../hooks/useReviewDraft';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';

const NOT_IMPLEMENTED = new Error('contest_list is not implemented yet');

beforeEach(() => {
  __resetContestStoreForTests();
  useContestFocus.setState({ focused: null, focusSeq: 0, surface: 'arena' });
  api.getContestEnvironment.mockResolvedValue({
    node: true,
    instrumentPath: null,
    engines: { claude: true, codex: false, grok: true },
    playwright: false,
    problems: ['instrument-missing', 'codex-missing'],
  });
  api.getContestLineups.mockResolvedValue([{ name: 'Frontier', seats: ['claude:claude-opus-5-5@xhigh'] }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContestPage', () => {
  it('mounts while the backend answers "not implemented" and shows the error, not an empty ledger', async () => {
    api.listContests.mockRejectedValue(NOT_IMPLEMENTED);
    render(<ContestPage />);
    expect(await screen.findByTestId('contest-page')).toBeInTheDocument();
    expect(await screen.findByTestId('contest-shell-arena')).toBeInTheDocument();
    await waitFor(() => expect(api.listContests).toHaveBeenCalled());
    expect(screen.queryByText('No contests yet')).not.toBeInTheDocument();
  });

  it('switches shells in memory and renders each stub', async () => {
    api.listContests.mockResolvedValue([summaryFixture()]);
    render(<ContestPage />);
    await screen.findByTestId('contest-shell-arena');
    fireEvent.click(screen.getByTestId('contest-surface-ledger'));
    expect(await screen.findByTestId('contest-shell-ledger')).toBeInTheDocument();
    expect(useContestFocus.getState().surface).toBe('ledger');
    fireEvent.click(screen.getByTestId('contest-surface-contact'));
    expect(await screen.findByTestId('contest-shell-contact')).toBeInTheDocument();
    expect(await screen.findByText('Hero page')).toBeInTheDocument();
  });

  it('names the readiness problems of the focused project', async () => {
    api.listContests.mockResolvedValue([]);
    useContestFocus.setState({ focused: { projectId: 'p1', contestId: 'x' } });
    render(<ContestPage />);
    expect(await screen.findByTestId('contest-readiness-strip')).toBeInTheDocument();
    expect(screen.getByText(/contest\.mjs/)).toBeInTheDocument();
  });
});

function ReviewHarness({ detail }: { detail: ContestDetail }) {
  const draft = useReviewDraft(detail);
  return (
    <div>
      <RunBoard detail={detail} />
      {detail.variants.map((v) => (
        <div key={v.key}>
          <VariantFrame variant={v} pins={draft.review ? [] : []} onAddPin={() => {}} />
          <ReviewSheet variant={v} draft={draft} />
        </div>
      ))}
      <FieldNoteEditor draft={draft} />
      <DecisionBar detail={detail} draft={draft} />
    </div>
  );
}

describe('shared components', () => {
  it('render a review contest end to end', async () => {
    const detail = detailFixture();
    render(<ReviewHarness detail={detail} />);
    expect(screen.getByTestId('contest-run-board')).toBeInTheDocument();
    // A seat that hit its limit offers a rerun; its errors stay folded.
    expect(screen.getByTestId('contest-seat-rerun-codex-gpt-6-sol_high')).toBeInTheDocument();
    // A variant with no preview says so calmly.
    expect(screen.getByTestId('contest-frame-unavailable-B/1')).toBeInTheDocument();
    // Sorting into Winner arms "Declare winner".
    const declare = screen.getByTestId('contest-decide-winner');
    expect(declare).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('contest-review-bucket-A/1-winner'));
    });
    expect(screen.getByTestId('contest-decide-winner')).not.toBeDisabled();
  });

  it('rerun launches exactly that seat', async () => {
    render(<RunBoard detail={detailFixture()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('contest-seat-rerun-codex-gpt-6-sol_high'));
    });
    expect(api.launchContest).toHaveBeenCalledWith('p1', 'hero-page', 'participant', ['codex-gpt-6-sol_high']);
  });

  it('the stats board renders decided contests', () => {
    render(
      <SeatStatsBoard
        contests={[
          summaryFixture({ phase: 'decided', winnerSeatSpec: 'codex:gpt-6-sol@high' }),
          summaryFixture({ contestId: 'b', phase: 'decided', winnerSeatSpec: 'codex:gpt-6-sol@high' }),
        ]}
      />,
    );
    expect(screen.getByTestId('contest-seat-stats')).toBeInTheDocument();
    expect(screen.getByText('codex:gpt-6-sol@high')).toBeInTheDocument();
  });
});
