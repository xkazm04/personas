// The verdict bar offers only what the backend can honour in the contest's
// phase (FE-4), and sends only a runner-up that is still shortlisted (FE-13).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from './fixtures';

const api = vi.hoisted(() => ({
  saveContestReview: vi.fn(async () => null),
  decideContest: vi.fn(),
}));
vi.mock('@/api/contest', () => api);

import { DecisionBar } from '../components/DecisionBar';
import { useReviewDraft } from '../hooks/useReviewDraft';
import { canRerun } from '../model/labels';
import { canDecide, emptyReview, setBucket } from '../model/reviewModel';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestReview } from '@/lib/bindings/ContestReview';

const PHASES: ContestPhase[] = ['draft', 'queued', 'running', 'collecting', 'judging', 'review', 'shortlisted', 'decided', 'failed'];

function detailIn(phase: ContestPhase, review: ContestReview | null, winner: string | null = null): ContestDetail {
  const base = detailFixture();
  return { ...base, summary: summaryFixture({ phase, winner }), review };
}

const withWinner = (): ContestReview => setBucket(emptyReview(detailFixture().variants), 'A/1', 'winner');
const withShortlist = (): ContestReview => setBucket(emptyReview(detailFixture().variants), 'A/1', 'shortlist');

function Bar({ detail }: { detail: ContestDetail }) {
  const draft = useReviewDraft(detail);
  return <DecisionBar detail={detail} draft={draft} />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('canDecide / canRerun', () => {
  it('a winner can be declared in review only; a refine in review and shortlisted', () => {
    expect(PHASES.filter((p) => canDecide(p, 'winner'))).toEqual(['review']);
    expect(PHASES.filter((p) => canDecide(p, 'refine'))).toEqual(['review', 'shortlisted']);
  });

  it('a lane rerun is never offered once the verdict is recorded, nor mid-chain for a participant', () => {
    expect(canRerun('decided', 'participant')).toBe(false);
    expect(canRerun('shortlisted', 'participant')).toBe(false);
    expect(canRerun('collecting', 'participant')).toBe(false);
    expect(canRerun('judging', 'participant')).toBe(false);
    expect(canRerun('judging', 'judge')).toBe(true);
    expect(canRerun('review', 'participant')).toBe(true);
    expect(canRerun('failed', 'participant')).toBe(true);
    expect(canRerun('running', 'participant')).toBe(true);
  });
});

describe('DecisionBar phase gate', () => {
  it('a decided contest is read-only and names its winner', () => {
    render(<Bar detail={detailIn('decided', withWinner(), 'A/1')} />);
    expect(screen.queryByTestId('contest-decide-winner')).toBeNull();
    expect(screen.queryByTestId('contest-decide-refine')).toBeNull();
    expect(screen.getByTestId('contest-decision-locked')).toHaveTextContent('A/1');
  });

  it('while the stewards judge, nothing can be declared', () => {
    render(<Bar detail={detailIn('judging', withWinner())} />);
    expect(screen.queryByTestId('contest-decide-winner')).toBeNull();
    expect(screen.getByTestId('contest-decision-locked')).toBeInTheDocument();
  });

  it('in review a sorted winner arms Declare', () => {
    render(<Bar detail={detailIn('review', withWinner())} />);
    expect(screen.getByTestId('contest-decide-winner')).not.toBeDisabled();
    expect(screen.queryByTestId('contest-decision-locked')).toBeNull();
  });

  it('a shortlisted parent offers only the refine retry', () => {
    render(<Bar detail={detailIn('shortlisted', withShortlist())} />);
    expect(screen.getByTestId('contest-decide-refine')).not.toBeDisabled();
    expect(screen.queryByTestId('contest-decide-winner')).toBeNull();
    expect(screen.getByTestId('contest-decision-locked')).toBeInTheDocument();
  });
});

describe('DecisionBar refine retry from the recorded shortlist', () => {
  // A shortlisted parent whose review.json was never saved (or was lost):
  // the owner's buckets are empty, but contest.json recorded the shortlist.
  // That recorded shortlist is the one the refine retry sends.
  function shortlistedWithoutReview(shortlist: string[]): ContestDetail {
    const base = detailFixture();
    return { ...base, summary: summaryFixture({ phase: 'shortlisted', shortlist }), review: null };
  }

  it('arms Refine and sends the recorded shortlist', async () => {
    api.decideContest.mockResolvedValue(summaryFixture({ contestId: 'draft-1-r2', phase: 'draft' }));
    render(<Bar detail={shortlistedWithoutReview(['A/1', 'B/1'])} />);
    const refine = screen.getByTestId('contest-decide-refine');
    expect(refine).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(refine);
    });
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Refine shortlist' }));
    });
    expect(api.decideContest).toHaveBeenCalledTimes(1);
    expect(api.decideContest.mock.calls[0]![2]).toMatchObject({ kind: 'shortlist', keys: ['A/1', 'B/1'] });
  });

  it('stays disarmed when nothing was recorded either', () => {
    render(<Bar detail={shortlistedWithoutReview([])} />);
    expect(screen.getByTestId('contest-decide-refine')).toBeDisabled();
  });
});

describe('DecisionBar runner-up (FE-13)', () => {
  it('a runner-up later promoted to Winner is not sent as runner-up', async () => {
    api.decideContest.mockResolvedValue(summaryFixture({ phase: 'decided', winner: 'B/1' }));
    const review = setBucket(setBucket(emptyReview(detailFixture().variants), 'A/1', 'winner'), 'B/1', 'shortlist');
    const { rerender } = render(<Bar detail={detailIn('review', review)} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Runner-up (optional)' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'B/1' }));
    });
    // The owner changes their mind: B/1 becomes the winner, A/1 drops to the shortlist.
    rerender(<Bar detail={detailIn('review', setBucket(review, 'B/1', 'winner'))} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('contest-decide-winner'));
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('Runner-up: B/1');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Declare winner' }));
    });
    expect(api.decideContest).toHaveBeenCalledTimes(1);
    expect(api.decideContest.mock.calls[0]![2]).toMatchObject({ kind: 'winner', winner: 'B/1', runnerUp: null });
  });
});
