import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createThrottledLocalStorage } from '@/lib/throttledStorage';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Snapshot-and-resume for the adoption interview.
 *
 * Adoption answers lived only in `ChronologyAdoptionView`'s local state, so
 * closing the wizard six questions into a ten-question interview threw the
 * whole thread away. Wizard flows treat interruption as the normal case: the
 * answers are a draft, and a draft that only exists in a component is lost the
 * moment the component unmounts.
 *
 * What this does NOT change is the commit boundary. The snapshot is a
 * convenience copy of in-progress input; adoption still commits nothing until
 * Continue, and `clear()` is called at exactly that point so a completed
 * interview never resurrects itself over a deliberate re-adoption.
 *
 * Writes go through `createThrottledLocalStorage`, which debounces the
 * per-keystroke churn and flushes on `pagehide`, rather than touching Web
 * Storage directly.
 */
const SNAPSHOT_PREFIX = 'template-adoption-answers-v1:';

/**
 * How long an abandoned interview stays resumable. An answer set older than
 * this is a different intent, not a resumption, so it is dropped on read.
 */
export const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredSnapshot {
  answers: Record<string, string>;
  savedAt: number;
}

const storage = createThrottledLocalStorage();

const keyFor = (reviewId: string) => `${SNAPSHOT_PREFIX}${reviewId}`;

/** Reads a snapshot, dropping anything malformed or past its TTL. */
export function readAnswerSnapshot(
  reviewId: string,
  now: number = Date.now(),
): Record<string, string> {
  try {
    const raw = storage.getItem(keyFor(reviewId));
    if (!raw) return {};
    // Shape invariant: this key is written only by `writeAnswerSnapshot`
    // below, so the parse is validated against StoredSnapshot's two fields
    // rather than trusted.
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot>;
    if (typeof parsed?.savedAt !== 'number' || now - parsed.savedAt > SNAPSHOT_TTL_MS) {
      storage.removeItem(keyFor(reviewId));
      return {};
    }
    const answers = parsed.answers;
    if (!answers || typeof answers !== 'object') return {};
    return Object.fromEntries(
      Object.entries(answers).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  } catch (err) {
    silentCatch('adoption/useAdoptionAnswerSnapshot:read')(err);
    return {};
  }
}

export function writeAnswerSnapshot(reviewId: string, answers: Record<string, string>): void {
  try {
    if (Object.keys(answers).length === 0) {
      storage.removeItem(keyFor(reviewId));
      return;
    }
    const payload: StoredSnapshot = { answers, savedAt: Date.now() };
    storage.setItem(keyFor(reviewId), JSON.stringify(payload));
  } catch (err) {
    silentCatch('adoption/useAdoptionAnswerSnapshot:write')(err);
  }
}

export function clearAnswerSnapshot(reviewId: string): void {
  try {
    storage.removeItem(keyFor(reviewId));
  } catch (err) {
    silentCatch('adoption/useAdoptionAnswerSnapshot:clear')(err);
  }
}

export interface AdoptionAnswerSnapshot {
  /** Answers restored for this review, read ONCE on mount. */
  restored: Record<string, string>;
  /** Persists the current answers; call on every change. */
  save: (answers: Record<string, string>) => void;
  /** Drops the snapshot. Call when the interview is committed or abandoned. */
  clear: () => void;
}

export function useAdoptionAnswerSnapshot(reviewId: string): AdoptionAnswerSnapshot {
  // Read once: a later re-read would fight the live state it restored.
  const [restored] = useState(() => readAnswerSnapshot(reviewId));
  const clearedRef = useRef(false);

  const save = useCallback(
    (answers: Record<string, string>) => {
      if (clearedRef.current) return;
      writeAnswerSnapshot(reviewId, answers);
    },
    [reviewId],
  );

  const clear = useCallback(() => {
    clearedRef.current = true;
    clearAnswerSnapshot(reviewId);
  }, [reviewId]);

  // A new review id is a different interview; allow it to save again.
  useEffect(() => {
    clearedRef.current = false;
  }, [reviewId]);

  // Memoized: callers put this object in an effect's dependency list, and a
  // fresh literal every render would make that effect run on every render.
  return useMemo(() => ({ restored, save, clear }), [restored, save, clear]);
}
