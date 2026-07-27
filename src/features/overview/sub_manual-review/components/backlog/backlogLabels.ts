// Display labels the Backlog's table AND its detail ledger both need. Kept in
// one place so the rail, the column chip and the modal can never disagree about
// what `mastermind` is called.
import { useCallback } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

/** The four scan-agent categories, in the order the filter lists them. */
export const BACKLOG_CATEGORY_KEYS = ['technical', 'user', 'business', 'mastermind'] as const;

/** Translated label for a category key; unknown keys render as themselves
 *  (categories are free text in storage, and a scanner may add one). */
export function useCategoryLabel(): (key: string) => string {
  const { t } = useTranslation();
  const r = t.overview.review;
  return useCallback(
    (key: string) =>
      ({
        technical: r.backlog_cat_technical,
        user: r.backlog_cat_user,
        business: r.backlog_cat_business,
        mastermind: r.backlog_cat_mastermind,
      })[key] ?? key,
    [r],
  );
}
