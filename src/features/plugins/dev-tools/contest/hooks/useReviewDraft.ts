// The owner's review of one contest, as a local draft that autosaves.
//
// Every edit is an immutable op from `reviewModel.ts`; the draft saves
// through `useDebouncedSave` (~800 ms after the last edit, flushed on unmount)
// and saves of one contest are chained so they land in the order they were
// issued — the newest review is always the one on disk. `flush()` saves NOW;
// a decision calls it first, because `refine --feedback` reads REVIEW.md.
import { useCallback, useRef, useState } from 'react';

import { saveContestReview } from '@/api/contest';
import { useDebouncedSave } from '@/hooks/utility/timing/useDebouncedSave';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestReview } from '@/lib/bindings/ContestReview';

import { seedReview } from '../model/reviewModel';
import { detailKey } from './contestStore';

export const REVIEW_AUTOSAVE_MS = 800;

/** In-flight save per contest, so a slow save cannot land after a newer one.
 *  Entries delete themselves when their chain drains. */
const saveChains = new Map<string, Promise<void>>();

function enqueueSave(key: string, write: () => Promise<unknown>): Promise<void> {
  const prev = saveChains.get(key) ?? Promise.resolve();
  // A failed earlier save was already reported to ITS caller; the next one
  // still runs (it carries the newer review).
  const next = prev.then(write, write).then(() => undefined);
  saveChains.set(key, next);
  const drop = () => {
    if (saveChains.get(key) === next) saveChains.delete(key);
  };
  void next.then(drop, drop);
  return next;
}

interface DraftState {
  key: string;
  review: ContestReview | null;
  /** The saved review this draft was seeded from (identity), to reseed on a
   *  refetch that brings a newer one while nothing is pending locally. */
  source: ContestReview | null | undefined;
  dirty: boolean;
}

export interface ReviewDraft {
  /** Null until a detail is loaded. */
  review: ContestReview | null;
  /** Apply one immutable op, e.g. `apply((r) => setBucket(r, 'A/2', 'winner'))`. */
  apply: (op: (review: ContestReview) => ContestReview) => void;
  dirty: boolean;
  isSaving: boolean;
  lastError: string | null;
  /** Save now (cancels the pending debounce). Rejects when the save fails. */
  flush: () => Promise<void>;
}

export function useReviewDraft(detail: ContestDetail | null): ReviewDraft {
  const projectId = detail?.summary.projectId ?? null;
  const contestId = detail?.summary.contestId ?? null;
  const key = projectId && contestId ? detailKey(projectId, contestId) : '';

  const [draft, setDraft] = useState<DraftState>({ key: '', review: null, source: undefined, dirty: false });

  // Adjust-state-on-prop-change: a new contest, or a refetched saved review
  // while no local edit is pending, reseeds the draft.
  let current = draft;
  if (detail && (draft.key !== key || (!draft.dirty && draft.source !== detail.review))) {
    current = { key, review: seedReview(detail.review, detail.variants), source: detail.review, dirty: false };
    setDraft(current);
  } else if (!detail && draft.key !== '') {
    current = { key: '', review: null, source: undefined, dirty: false };
    setDraft(current);
  }

  const reviewRef = useRef<ContestReview | null>(current.review);
  reviewRef.current = current.review;
  const idsRef = useRef({ projectId, contestId, key });
  idsRef.current = { projectId, contestId, key };

  const save = useCallback(async () => {
    const { projectId: p, contestId: c, key: k } = idsRef.current;
    const snapshot = reviewRef.current;
    if (!p || !c || !snapshot) return;
    await enqueueSave(k, () => saveContestReview(p, c, snapshot));
    // Only clear dirty if nothing was edited while the save was in flight.
    setDraft((d) => (d.key === k && d.review === snapshot ? { ...d, dirty: false } : d));
  }, []);

  const { isSaving, lastError, cancel } = useDebouncedSave(
    save,
    current.dirty,
    [current.review],
    REVIEW_AUTOSAVE_MS,
  );

  const apply = useCallback((op: (review: ContestReview) => ContestReview) => {
    setDraft((d) => (d.review ? { ...d, review: op(d.review), dirty: true } : d));
  }, []);

  const flush = useCallback(async () => {
    cancel();
    await save();
  }, [cancel, save]);

  return { review: current.review, apply, dirty: current.dirty, isSaving, lastError, flush };
}
