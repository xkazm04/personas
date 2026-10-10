/**
 * How an evidence step measures, as a story over time: the done rate now (the
 * figure the verdict was judged on, with its n and its move since the earlier
 * window), a legend for the columns, and the adherence figure under it. A step
 * whose snapshot carries no done rate (a custom step) leads with nothing and
 * lets the columns speak.
 */
import type { ReactNode } from 'react';

import { Meta, Section } from '@/features/shared/components/kit';

import { useLifecycleViewModel } from '../../context';
import { metricDelta } from '../../layer1/delta';
import { VERDICT, type HealthStep } from '../../layer1/healthModel';
import { MetricValue, SampleNote } from '../../layer1/parts/MetricValue';
import { DeltaMark } from '../../layer1/rail/DeltaMark';
import { RHYTHM } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import type { StepThresholds } from '../../system/rules';
import { AdherenceFigure } from './AdherenceFigure';
import { CHANGES_PER_BUCKET, type Adherence } from './adherence';

function Legend() {
  const { dl } = useLifecycleViewModel();
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-1 ${LT.meta}`} data-testid="lc8-legend">
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-interactive bg-status-success" aria-hidden />
        {dl.lcx8_legend_judged}
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-interactive border-2 border-dashed border-foreground/50" aria-hidden />
        {dl.lcx8_legend_too_few}
      </span>
    </div>
  );
}

function RateNow({ step }: { step: HealthStep }) {
  const { dl } = useLifecycleViewModel();
  const done = step.metrics.find((m) => m.key === 'done_rate') ?? null;
  if (!done) return null;
  const was = step.previous?.metrics.find((m) => m.key === 'done_rate')?.value ?? null;
  return (
    <div className="flex flex-col gap-1" data-testid="lc2-done-rate">
      <span className={LT.label}>{dl.lcx8_rate_now}</span>
      <span className="flex items-baseline gap-3">
        <MetricValue metric={done} className={`${LT.stat} ${VERDICT[step.health].ink}`} />
        <DeltaMark delta={metricDelta('done_rate', done.value, was)} />
      </span>
      <SampleNote metric={done} />
    </div>
  );
}

interface Props {
  step: HealthStep;
  series: Adherence;
  thresholds: StepThresholds;
  stepKey: string;
  loading: boolean;
  /** Drawn first inside the section (a custom step's instructed note). */
  lead?: ReactNode;
}

export function AdherenceSection({ step, series, thresholds, stepKey, loading, lead }: Props) {
  const { dl, tx } = useLifecycleViewModel();
  const { doneRatePct: green, amberFloorPct: amber } = thresholds;
  const nothing = series.buckets.length === 0;
  return (
    <Section
      title={dl.lc2_measure_title}
      level={2}
      desc={tx(dl.lc2_done_threshold, { green, amber })}
      state={loading ? 'loading' : nothing ? 'empty' : undefined}
      empty={{ title: dl.lcx8_no_rate }}
      ghostRows={4}
    >
      <div className={RHYTHM.block}>
        {lead && <div className="k-in">{lead}</div>}
        <div className={`k-in flex flex-wrap items-end justify-between ${RHYTHM.inlineWide}`}>
          <RateNow step={step} />
          <div className={`flex flex-col items-end ${RHYTHM.tight}`}>
            <Legend />
            <span className={`flex flex-wrap gap-x-2 ${LT.meta}`}>
              <Meta parts={[
                series.mode === 'week' ? dl.lcx8_axis_week : tx(dl.lcx8_axis_changes, { size: CHANGES_PER_BUCKET }),
                series.clipped > 0 ? tx(dl.lcx8_clipped, { count: series.clipped }) : null,
              ]} />
            </span>
          </div>
        </div>
        <AdherenceFigure series={series} target={green} amber={amber} stepKey={stepKey} />
      </div>
    </Section>
  );
}
