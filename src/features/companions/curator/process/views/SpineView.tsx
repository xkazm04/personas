import { useTranslation } from '@/i18n/useTranslation';
import { SpineSummary } from '../SpineSummary';
import { SpineStation } from '../SpineStation';
import { SpineOutcomes } from '../SpineOutcomes';
import type { ProcessViewProps } from './types';

/** The original view: the spine read top to bottom, one station per phase. */
export default function SpineView({ reading, repo, model, base }: ProcessViewProps) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;

  return (
    <div className="mx-auto w-full max-w-6xl px-2 py-6">
      <SpineSummary model={model} />
      <p className="mt-6 mb-10 max-w-3xl typo-body text-foreground">
        {p.path_note} {p.mode_note} {p.time_note}
      </p>
      <ol aria-label={t.companions.nav.page_process}>
        {model.stations.map((s, i) => (
          <SpineStation
            key={s.keys.join('|')}
            station={s}
            total={model.n}
            cohort={repo ? base.stations[i] : undefined}
            cohortTotal={repo ? base.n : undefined}
            rank={model.worst.slice(0, 3).includes(s.index) ? model.worst.indexOf(s.index) + 1 : undefined}
            last={i === model.stations.length - 1}
          />
        ))}
      </ol>
      <SpineOutcomes outcomes={model.outcomes} total={model.n} />
      <p className="mt-8 typo-caption tabular-nums">
        {tx(p.source, { scanned: reading.source.scanned, cached: reading.source.cached })}
      </p>
    </div>
  );
}
