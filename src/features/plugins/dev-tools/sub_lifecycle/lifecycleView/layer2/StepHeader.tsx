// The top of a step's screen: the trail back to Layer 1 with the walk to the
// neighbouring steps, then the step itself - its key, name, verdict and why -
// beside its instrument (the metrics drawn large around its icon).
import { forwardRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Crumbs } from '@/features/shared/components/kit';

import { stepGlyph, stepLabel } from '../../journey/journeyLabels';
import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { VERDICT, type HealthStep } from '../layer1/healthModel';
import { healthPhrase, reasonLine } from '../layer1/layer1Labels';
import { VerdictBadge } from '../layer1/parts/VerdictBadge';
import { KeyCap } from '../TactileKeys';
import { StepInstrument } from './StepInstrument';

interface StepHeaderProps {
  step: HealthStep;
  prev: JourneyNode | null;
  next: JourneyNode | null;
}

export const StepHeader = forwardRef<HTMLHeadingElement, StepHeaderProps>(function StepHeader({ step, prev, next }, titleRef) {
  const { dl, tx, closeStep, openStep } = useLifecycleViewModel();
  const { node } = step;
  const label = stepLabel(dl, node.id, node.label);
  const Glyph = stepGlyph(node.id);
  const reason = reasonLine(dl, step.health, step.reason);
  const neighbour = (n: JourneyNode | null, dir: 'prev' | 'next') => n && (
    <Button
      variant="secondary"
      size="sm"
      icon={dir === 'prev' ? <ChevronLeft className="h-4 w-4" /> : undefined}
      iconRight={dir === 'next' ? <ChevronRight className="h-4 w-4" /> : undefined}
      onClick={() => openStep(n.id)}
      aria-label={tx(dir === 'prev' ? dl.lc2_prev_step : dl.lc2_next_step, { step: stepLabel(dl, n.id, n.label) })}
      data-testid={`lc2-${dir}`}
    >
      {stepLabel(dl, n.id, n.label)}
    </Button>
  );

  return (
    <header className="space-y-4" data-testid="lc2-header">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Crumbs
          label={dl.lc2_trail_label}
          items={[
            { label: dl.lc2_trail_root, onPress: closeStep, testId: 'lc2-back' },
            { label },
          ]}
        />
        <div className="flex items-center gap-2">
          {neighbour(prev, 'prev')}
          {neighbour(next, 'next')}
        </div>
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-x-10 gap-y-6 rounded-modal px-6 py-5 ${VERDICT[step.health].outline} ${VERDICT[step.health].wash}`}>
        <div className="flex min-w-0 max-w-2xl flex-1 items-start gap-4">
          <KeyCap state={node.strongestState} pressed size="lg">
            <Glyph className={`h-6 w-6 ${VERDICT[step.health].ink}`} aria-hidden />
          </KeyCap>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 ref={titleRef} tabIndex={-1} className="typo-heading-lg text-foreground outline-none" data-testid="lc2-title">{label}</h2>
              <VerdictBadge health={step.health} size="lg" />
            </div>
            {reason && <p className="typo-body-lg text-foreground" data-testid="lc2-reason">{reason}</p>}
            <p className="flex flex-wrap items-center gap-x-3 typo-caption">
              <span>{node.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}</span>
              {step.measuredAt && (
                <span>
                  {dl.lc2_measured}{' '}
                  <RelativeTime timestamp={step.measuredAt} />
                </span>
              )}
              {step.staleOf && <span className="text-status-info">{tx(dl.lc2_stale_of, { health: healthPhrase(dl, step.staleOf) })}</span>}
            </p>
          </div>
        </div>
        <StepInstrument step={step} />
      </div>
    </header>
  );
});
