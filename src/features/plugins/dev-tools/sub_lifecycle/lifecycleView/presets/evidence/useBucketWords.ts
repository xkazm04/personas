// The words for one adherence column, in the reader's language: its short
// axis label ("Oct 6"), and the sentence its hover and the screen-reader list
// say ("Week of Oct 6: done in 7 of 9 changes (78%)", or too few to judge,
// or no changes). Day numbers are local days, formatted in UTC on purpose
// (`dayAsUtcDate`), so the label is the day the change was counted on.
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { useSnapshotRules } from '../../system/useSnapshotRules';
import { dayAsUtcDate, type Adherence, type AdherenceBucket } from './adherence';

export interface BucketWords {
  short: (b: AdherenceBucket) => string;
  period: (b: AdherenceBucket) => string;
  sentence: (b: AdherenceBucket) => string;
}

export function useBucketWords(mode: Adherence['mode']): BucketWords {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const { minSamples } = useSnapshotRules();
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const day = (d: number) => fmt.format(dayAsUtcDate(d));
    const short = (b: AdherenceBucket) => day(mode === 'week' ? b.fromDay : b.toDay);
    const period = (b: AdherenceBucket) => (mode === 'week'
      ? tx(dl.lcx8_bar_week, { date: day(b.fromDay) })
      : tx(dl.lcx8_bar_changes, { from: day(b.fromDay), to: day(b.toDay) }));
    const sentence = (b: AdherenceBucket) => {
      const label = period(b);
      if (b.n === 0) return tx(dl.lcx8_bar_none, { label });
      if (!b.judged) return tx(dl.lcx8_bar_too_few, { label, n: b.n, need: minSamples });
      const rate = formatNumeric(b.ratePct, 'percent', { precision: 0, language });
      return tx(dl.lcx8_bar_rate, { label, done: b.done, n: b.n, rate });
    };
    return { short, period, sentence };
  }, [dl, tx, language, minSamples, mode]);
}
