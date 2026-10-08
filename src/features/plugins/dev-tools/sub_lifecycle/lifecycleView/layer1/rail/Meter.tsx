/**
 * A rail card's figure drawn as a quantity: a track its main rate fills in
 * the verdict's ink, with two marks a reader can tell apart without colour -
 *
 * - the GREEN LINE (a tall bar) where the step turns healthy, from the rules
 *   the snapshot ships (`system/rules.greenLineFor`);
 * - the EARLIER MEASURE (a hollow bead) where the figure stood one measurement
 *   ago, so the gap between bead and fill IS the change.
 *
 * Unknown is never drawn as zero: a step with no value draws a dashed empty
 * track; an instructed step draws a hairline (the pipe still passes through
 * it, by instruction). A stale fill is hatched. The fill grows in once, on the
 * project's first entrance (`system/entrance`). Drawn parts only: the meter is
 * `aria-hidden`, the figure beside it is what a reader hears.
 */
import { motion } from 'framer-motion';

import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import { useEntrance } from '../../system/entrance';
import { METER } from '../../system/scales';
import { VERDICT, metricRatio, type StepMetric } from '../healthModel';

interface MeterProps {
  health: LifecycleHealth;
  figure: StepMetric | null;
  /** The figure one measurement earlier (same scale), or null. */
  previous: number | null;
  /** The green line on the figure's scale, or null when the metric has none. */
  greenLine: number | null;
  /** Dim the drawing (the card is outside the verdict highlight). */
  dim?: boolean;
}

const pct = (ratio: number) => `${Math.round(Math.max(0, Math.min(1, ratio)) * 10_000) / 100}%`;

export function Meter({ health, figure, previous, greenLine, dim = false }: MeterProps) {
  const entering = useEntrance();
  const v = VERDICT[health];
  const fade = `transition-opacity duration-200 motion-reduce:transition-none ${dim ? 'opacity-40' : 'opacity-100'}`;
  if (health === 'instructed' || !figure) {
    return <span aria-hidden className={`block h-px w-full bg-primary/25 ${fade}`} data-meter="hairline" />;
  }
  const ratio = figure.ratio;
  const prev = metricRatio(figure.key, previous);
  const line = metricRatio(figure.key, greenLine);
  const unknown = ratio == null || !v.fill;
  return (
    <span aria-hidden className={`relative block w-full ${fade}`} data-meter={unknown ? 'empty' : 'filled'}>
      <span
        className={`block ${METER.track} w-full rounded-pill ${
          unknown ? 'border border-dashed border-foreground/45 bg-transparent' : `bg-primary/10 ${v.hatched ? 'lc1-hatch' : ''}`
        }`}
      />
      {!unknown && ratio > 0 && (
        <motion.span
          className={`absolute inset-y-0 left-0 block origin-left rounded-pill ${v.fill}`}
          style={{ width: pct(ratio) }}
          initial={entering ? { scaleX: 0 } : false}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      {line != null && (
        <span
          className={`absolute top-1/2 block w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-foreground/70 ${METER.mark}`}
          style={{ left: pct(line) }}
          data-mark="green-line"
        />
      )}
      {prev != null && !unknown && (
        <span
          className={`absolute top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-background ${METER.bead}`}
          style={{ left: pct(prev) }}
          data-mark="previous"
        />
      )}
    </span>
  );
}
