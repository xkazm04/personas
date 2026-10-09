// A rail card's figure: the step's main rate at the `stat` role with its unit
// set at the `label` role ("92" large, "%" small), so the figure keeps its
// size and still fits a card of six-to-a-lane at 1280 wide. The parts come
// from the locale's own percent format (`formatToParts`), so a locale that
// spaces or leads the sign keeps its order. Unknown is "N/A" in letters,
// never 0.
import { Fragment } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { RATE_SCALE, type StepMetric } from '../healthModel';

const formats = new Map<string, Intl.NumberFormat>();

export function percentFormat(language: string): Intl.NumberFormat {
  let f = formats.get(language);
  if (!f) {
    f = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 });
    formats.set(language, f);
  }
  return f;
}

/** The figure as words for a reader ("40%"), or null when it is unknown. */
export function figureWords(metric: StepMetric, language: string): string | null {
  return metric.value == null ? null : percentFormat(language).format(metric.value / RATE_SCALE);
}

export function FigureValue({ metric }: { metric: StepMetric }) {
  const { dl } = useLifecycleViewModel();
  const { language } = useTranslation();
  if (metric.value == null) return <span className={LT.stat} data-na="true">{dl.lc1_na}</span>;
  const parts = percentFormat(language).formatToParts(metric.value / RATE_SCALE);
  return (
    <span className={`whitespace-nowrap tabular-nums ${LT.stat}`} data-figure={metric.key}>
      {parts.map((p, i) => (p.type === 'percentSign'
        ? <span key={i} className={LT.label}>{p.value}</span>
        : <Fragment key={i}>{p.value}</Fragment>))}
    </span>
  );
}
