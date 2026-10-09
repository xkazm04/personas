/**
 * The figure half of a rail card, three fixed rows (`cardRows`):
 *
 * 1. FIGURE: the step's main rate as the card's stat (`FigureValue`; N/A when
 *    unknown, never 0); beside it, stacked, its change since the earlier
 *    measure and its sample count. The figure never yields width: when a
 *    card is too narrow for all three, the change clips first. An instructed
 *    step puts the rule's glyph and "By instruction" in the same slot, at the
 *    same height.
 * 2. METER: the rate as a quantity, the green line, the earlier measure's
 *    bead; the pipe from the upstream card enters here.
 * 3. LABEL: what the figure is ("Done rate"), then - when the card is wide
 *    enough - the step's other numbers as one chip line that clips rather
 *    than wraps (the peek always lists them all).
 */
import type { ReactNode } from 'react';
import { CircleCheck, ScrollText, ShieldCheck, Timer, type LucideIcon } from 'lucide-react';

import type { LifecycleMetricKey } from '@/lib/bindings/LifecycleMetricKey';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { greenLineFor, thresholdsFor } from '../../system/rules';
import { GLYPH } from '../../system/scales';
import type { StepChange } from '../delta';
import type { HealthStep, StepMetric } from '../healthModel';
import { metricLabel } from '../layer1Labels';
import { MetricValue } from '../parts/MetricValue';
import { CARD_ROW, lineSlot } from './cardRows';
import { DeltaMark } from './DeltaMark';
import { FigureValue } from './FigureValue';
import { Meter } from './Meter';

const CHIP_GLYPH: Record<LifecycleMetricKey, LucideIcon> = {
  median_ms: Timer,
  pass_rate: CircleCheck,
  coverage_pct: ShieldCheck,
  docs_clean_pct: ScrollText,
  done_rate: CircleCheck,
};

interface CardFigureProps {
  step: HealthStep;
  change: StepChange | null;
  /** The pipe entering this card from the upstream one, drawn on the meter's line. */
  pipe?: ReactNode;
  dim?: boolean;
  /** A Measure is measuring the step: a streak sweeps the meter. */
  measuring?: boolean;
}

/** The step's other numbers, one chip each (glyph + value), on one clipped line. */
function Chips({ metrics }: { metrics: StepMetric[] }) {
  const { dl } = useLifecycleViewModel();
  return (
    <span className="hidden h-[1lh] min-w-0 flex-1 flex-wrap justify-end gap-x-2 overflow-hidden @[11rem]/card:flex">
      {metrics.map((m) => {
        const Glyph = CHIP_GLYPH[m.key];
        return (
          <span key={m.key} className="inline-flex shrink-0 items-center gap-1">
            <Glyph className={`${GLYPH.sm} text-primary`} aria-hidden />
            <span className="sr-only">{metricLabel(dl, m.key)}</span>
            <MetricValue metric={m} className={LT.label} />
          </span>
        );
      })}
    </span>
  );
}

export function CardFigure({ step, change, pipe, dim = false, measuring = false }: CardFigureProps) {
  const { dl, tx, snapshot } = useLifecycleViewModel();
  const { figure } = step;
  const instructed = step.health === 'instructed' || !figure;
  const greenLine = figure && snapshot ? greenLineFor(figure.key, thresholdsFor(snapshot.rules, step.node.view.step.params)) : null;
  const before = figure && step.previous ? step.previous.metrics.find((m) => m.key === figure.key)?.value ?? null : null;
  const rest = step.metrics.filter((m) => m !== figure);
  return (
    <>
      <div className={CARD_ROW.figure} data-row="figure">
        {instructed ? (
          <span className={`flex min-w-0 items-center gap-2 ${LT.stat}`}>
            <ScrollText className={`${GLYPH.md} shrink-0 text-primary`} aria-hidden />
            <span className={`truncate ${LT.title}`}>{dl.lcx2_by_instruction}</span>
          </span>
        ) : (
          <FigureValue metric={figure} />
        )}
        <span className="flex min-w-0 flex-col items-end overflow-hidden">
          <span className={lineSlot('delta')}>{!instructed && <DeltaMark delta={change?.figure ?? null} unitWhenWide />}</span>
          <span className={lineSlot('metaNum')}>
            {!instructed && figure.value != null && tx(dl.lcx2_samples_compact, { count: figure.samples })}
          </span>
        </span>
      </div>
      <div className={CARD_ROW.meter} data-row="meter">
        {pipe}
        <Meter health={step.health} figure={figure} previous={before} greenLine={greenLine} dim={dim} measuring={measuring} />
      </div>
      <div className={CARD_ROW.label} data-row="label">
        <span className="max-w-full shrink-0 truncate">
          {instructed ? dl.lcx2_by_instruction_note : metricLabel(dl, figure.key)}
        </span>
        {!instructed && rest.length > 0 && <Chips metrics={rest} />}
      </div>
    </>
  );
}
