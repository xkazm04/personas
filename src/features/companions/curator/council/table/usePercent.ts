// One locale-aware percent formatter for the whole council surface.
//
// `formatPercent` is the app's shared helper; this binds it to the active
// language once so a coverage ring, a weight line and a gate sentence cannot
// end up formatting the same ratio three different ways.
import { useCallback } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatPercent } from '@/lib/utils/formatters';

export function usePercent(): (ratio: number) => string {
  const { language } = useTranslation();
  return useCallback(
    (ratio: number) => formatPercent(ratio, { fromRatio: true, precision: 0, language }),
    [language],
  );
}
