/**
 * Review status labels come from the catalog, and `resolved` is not `pending`.
 *
 * The row pill used a hardcoded English map with no `resolved` entry and a
 * 'Pending' fallback, so every review the stale-review sweep auto-resolved
 * (manual_reviews.rs GC, startup + the Clear-stale button) read as Pending in
 * the All view. The filter tabs and source switch were English in every locale.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { getActiveTranslations, preloadSectionsAsync } from '@/i18n/useTranslation';
import { reviewSourceLabel, reviewStatusLabel } from '../reviewHelpers';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

describe('reviewStatusLabel', () => {
  it('a resolved review is labelled resolved, never pending', () => {
    const t = getActiveTranslations();
    expect(reviewStatusLabel(t, 'resolved')).toBe(t.overview.incidents.filter_status_resolved);
    expect(reviewStatusLabel(t, 'resolved')).not.toBe(t.overview.review.filter_pending);
  });

  it('reads every filter tab from the catalog', () => {
    const t = getActiveTranslations();
    expect(reviewStatusLabel(t, 'all')).toBe(t.overview.review.filter_all);
    expect(reviewStatusLabel(t, 'pending')).toBe(t.overview.review.filter_pending);
    expect(reviewStatusLabel(t, 'approved')).toBe(t.overview.review.filter_approved);
    expect(reviewStatusLabel(t, 'rejected')).toBe(t.overview.review.filter_rejected);
  });

  it('an unknown token shows itself instead of borrowing a real status', () => {
    expect(reviewStatusLabel(getActiveTranslations(), 'escalated')).toBe('escalated');
  });

  it('source labels come from the catalog', () => {
    const t = getActiveTranslations();
    expect(reviewSourceLabel(t, 'cloud')).toBe(t.overview.review.source_cloud);
    expect(reviewSourceLabel(t, 'local')).toBe(t.overview.review.source_local);
    expect(reviewSourceLabel(t, 'all')).toBe(t.overview.review.source_all);
  });
});
