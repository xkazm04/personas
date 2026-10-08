/**
 * DIRECTION B (Collar rail) - one step: the rail's key cap on the groove, its
 * name, and beneath it a COLLAR the key wears - a panel in the verdict's own
 * stroke and fill with the verdict pill, an arc that draws the step's main
 * rate with the figure inside it, the other numbers as stacked stat chips, and
 * the evidence beads. The column is one press target (stretched); the key cap
 * is the tab stop.
 */
import { motion } from 'framer-motion';

import { stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import type { StepRoving } from '../../blocks/useStepRoving';
import { useLifecycleViewModel } from '../../context';
import { enterDelay } from '../../railShared';
import { KeyCap } from '../../TactileKeys';
import { VERDICT, isRateKey, type HealthStep } from '../healthModel';
import { metricLabel, reasonLine } from '../layer1Labels';
import { ArcGauge } from '../parts/ArcGauge';
import { MetricValue, SampleNote } from '../parts/MetricValue';
import { StepBeads } from '../parts/StepBeads';
import { StepPress } from '../parts/StepPress';
import { VerdictBadge } from '../parts/VerdictBadge';

const GROOVE = 'absolute top-6 -translate-y-1/2 h-0.5 bg-primary/15';

interface CollarColumnProps {
  step: HealthStep;
  index: number;
  roving: StepRoving;
  first: boolean;
  last: boolean;
}

function Collar({ step }: { step: HealthStep }) {
  const { dl } = useLifecycleViewModel();
  const v = VERDICT[step.health];
  const main = step.metrics.find((m) => isRateKey(m.key)) ?? null;
  const rest = step.metrics.filter((m) => m !== main);
  return (
    <div className={`pointer-events-none flex w-full flex-col items-center gap-2.5 rounded-card px-2 pb-3 pt-2.5 ${v.outline} ${v.wash}`}>
      <VerdictBadge health={step.health} />
      {main ? (
        <div className="flex flex-col items-center">
          <ArcGauge health={step.health} ratio={main.ratio} size={112} stroke={9} shape="arc">
            <MetricValue metric={main} className="mt-7 typo-data-lg text-foreground" />
          </ArcGauge>
          <span className="typo-label text-foreground">{metricLabel(dl, main.key)}</span>
          <SampleNote metric={main} />
        </div>
      ) : (
        <p className="px-1 text-center typo-caption">{reasonLine(dl, step.health, step.reason)}</p>
      )}
      {rest.map((m) => (
        <span key={m.key} className="flex w-full flex-col rounded-interactive bg-background/70 px-2.5 py-1.5 shadow-elevation-1">
          <span className="typo-label text-foreground">{metricLabel(dl, m.key)}</span>
          <MetricValue metric={m} className="typo-data text-foreground" />
          <SampleNote metric={m} />
        </span>
      ))}
    </div>
  );
}

export function CollarColumn({ step, index, roving, first, last }: CollarColumnProps) {
  const { dl, selected } = useLifecycleViewModel();
  const { node } = step;
  const on = node.id === selected?.id;
  const Glyph = stepGlyph(node.id);
  return (
    <motion.li
      className={`relative flex min-w-0 flex-col items-center gap-2 rounded-card pb-2 transition-colors ${on ? 'bg-primary/10' : 'hover:bg-secondary/40'}`}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30, delay: enterDelay(index, 0.04) }}
    >
      {!first && <span aria-hidden className={`${GROOVE} -left-1 right-1/2`} />}
      {!last && <span aria-hidden className={`${GROOVE} left-1/2 -right-1`} />}
      <span className="flex h-12 items-center justify-center">
        <StepPress step={step} index={index} roving={roving}>
          <KeyCap state={node.strongestState} pressed={on}>
            <Glyph className={`h-5 w-5 ${VERDICT[step.health].ink}`} aria-hidden />
          </KeyCap>
        </StepPress>
      </span>
      <span className={`max-w-full truncate px-1 text-center text-foreground ${on ? 'typo-heading' : 'typo-body'}`}>
        {stepLabel(dl, node.id, node.label)}
      </span>
      <Collar step={step} />
      <StepBeads node={node} delay={enterDelay(index, 0.04, 0.3)} />
    </motion.li>
  );
}
