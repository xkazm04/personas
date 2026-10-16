import { useCallback, useEffect, useMemo, useState } from 'react';
import { listManualReviewsPage } from '@/api/overview/reviews';
import { dispatchReviewRowAction, resolveReviewRow } from '@/lib/decisions/rowWrites';
import { extractMessage, silentCatch, toastCatch } from '@/lib/silentCatch';
import { usePendingInteractions } from '@/features/agents/quick-answer/usePendingInteractions';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { useMonitorVisible } from '../monitorVisibility';
import { buildAsks, type Ask, type QuestionAsk, type ReviewAsk } from './needsYouModel';

/* ----------------------------------------------------------------------------
 * PENDING ASKS - the data behind the Needs you rail and the projects' You figure.
 *
 * ONE read of the pending reviews for the whole fleet (it was one read PER
 * MEMBER of the open team, every 30 s), so every project row can light its
 * lamp, plus the held build questions the Quick tab used to show. Lean on
 * purpose: a 30 s poll while the Monitor is on screen, nothing while hidden.
 *
 * Loading and failing are not "nothing waiting": `readable` stays false until
 * the first read lands and whenever the last one failed, and every reader
 * (the rail's lamp, the You figures) renders dark rather than "0" then.
 * -------------------------------------------------------------------------- */

const POLL_MS = 30_000;
/** The backend's own ceiling for one page. */
const PAGE = 200;

/** This queue lists local rows only (the cloud worker's own reviews reach the deck). */
const row = (a: ReviewAsk) => ({ id: a.id, execution_id: a.executionId ?? '', source: 'local' as const });

export interface PendingAsks {
  asks: Ask[];
  readable: boolean;
  loading: boolean;
  error: string | null;
  busy: boolean;
  refresh: () => void;
  approve: (ask: ReviewAsk, note?: string) => Promise<void>;
  reject: (ask: ReviewAsk, note?: string) => Promise<void>;
  branch: (ask: ReviewAsk, action: string) => Promise<void>;
  answer: (ask: QuestionAsk, value: string) => Promise<void>;
}

export function usePendingAsks(): PendingAsks {
  const visible = useMonitorVisible();
  const { questionGroups, submitQuestionAnswers } = usePendingInteractions();
  const [reviews, setReviews] = useState<PersonaManualReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listManualReviewsPage({ status: 'pending', limit: PAGE })
      .then((page) => { setError(null); setReviews(page.rows); })
      .catch((e) => { setError(extractMessage(e)); silentCatch('conversation:pendingReviews')(e); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [visible, refresh]);

  /** One write at a time; a failed verdict toasts and re-reads, so the ask comes back rather than vanishing. */
  const write = useCallback(async (id: string | null, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      if (id) setReviews((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      toastCatch('conversation:needsYou')(e);
      refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const approve = useCallback((a: ReviewAsk, note?: string) => write(a.id, () => resolveReviewRow(row(a), 'approved', note)), [write]);
  const reject = useCallback((a: ReviewAsk, note?: string) => write(a.id, () => resolveReviewRow(row(a), 'rejected', note)), [write]);
  const branch = useCallback((a: ReviewAsk, action: string) => write(a.id, () => dispatchReviewRowAction(row(a), action)), [write]);
  const answer = useCallback(
    (a: QuestionAsk, value: string) => write(null, () => submitQuestionAnswers(a.sessionId, { [a.cellKey]: value })),
    [write, submitQuestionAnswers],
  );

  const asks = useMemo(() => buildAsks(reviews, questionGroups), [reviews, questionGroups]);
  return { asks, readable: !loading && !error, loading, error, busy, refresh, approve, reject, branch, answer };
}
