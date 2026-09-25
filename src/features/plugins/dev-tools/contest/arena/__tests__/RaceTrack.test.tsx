// The track header (FE-3): a scheduled start reads its real distance ("Starts
// in 6 hours"), never "Starts now".
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detailFixture } from '../../__tests__/fixtures';

const api = vi.hoisted(() => ({
  saveContestReview: vi.fn(async () => null),
  launchContest: vi.fn(async () => null),
  cancelContest: vi.fn(async () => null),
  runContestStep: vi.fn(async () => null),
}));
vi.mock('@/api/contest', () => api);

import type { ContestDetail } from '@/lib/bindings/ContestDetail';

import { useReviewDraft } from '../../hooks/useReviewDraft';
import { formatUntil } from '../arenaModel';
import { RaceTrack } from '../RaceTrack';

afterEach(cleanup);

function Track({ detail }: { detail: ContestDetail }) {
  const draft = useReviewDraft(detail);
  return <RaceTrack detail={detail} draft={draft} onOpenVariant={() => {}} />;
}

describe('scheduled start', () => {
  it('formatUntil speaks a future distance', () => {
    const now = Date.UTC(2026, 8, 25, 9, 0, 0);
    expect(formatUntil(now + 6 * 3_600_000, now, 'en')).toBe('in 6 hours');
    expect(formatUntil(now + 16 * 3_600_000 + 20 * 60_000, now, 'en')).toBe('in 16 hours');
    expect(formatUntil(now + 25 * 60_000, now, 'en')).toBe('in 25 minutes');
    expect(formatUntil(now + 3 * 86_400_000, now, 'en')).toBe('in 3 days');
    expect(formatUntil(now + 20_000, now, 'en')).toBe('in 1 minute');
  });

  it('a queued race scheduled six hours ahead reads "Starts in 6 hours"', () => {
    const base = detailFixture();
    const detail: ContestDetail = {
      ...base,
      summary: { ...base.summary, phase: 'queued' },
      notBeforeMs: Date.now() + 6 * 3_600_000 + 30_000,
      seats: base.seats.map((s) => ({ ...s, state: 'queued', startedAtMs: null })),
    };
    render(<Track detail={detail} />);
    expect(screen.getByTestId('arena-track-start')).toHaveTextContent(/in 6 hours/);
    expect(screen.getByTestId('arena-track-start')).not.toHaveTextContent(/now/);
  });
});
