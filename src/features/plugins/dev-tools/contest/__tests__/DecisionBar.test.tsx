// The verdict bar offers only what the backend can honour in the contest's
// phase (FE-4).
import { cleanup, render, screen } from '@testing-library/react';
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
