/**
 * The peek: what a card holds that layer one has no room for, without
 * leaving the rail. The step's verdict and why; every metric with its sample
 * count and its change since the earlier measure; when it was measured and on
 * which tip; the earlier verdict and figure; the step's recent outcomes as
 * labelled marks; and what enforces it. Inert like every tip (nothing in it
 * takes focus); Enter or a click on the card opens the step's own screen.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { stepLabel } from '../../../journey/journeyLabels';
import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { LT } from '../../system/lcType';
import { VerdictPill } from '../../system/Pill';
import { stepChange, type MetricDelta } from '../delta';
import type { HealthStep } from '../healthModel';
import { metricLabel, reasonLine } from '../layer1Labels';
import { MetricValue, SampleNote } from '../parts/MetricValue';
import { DeltaMark } from './DeltaMark';
import { PeekEvidence } from './PeekEvidence';

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : null);

function Change({ delta, known }: { delta: MetricDelta | undefined; known: boolean }) {
  const { dl } = useLifecycleViewModel();
  if (!known) return <span />;
  if (!delta) return <span className={LT.meta}>{dl.lcx2_peek_no_earlier}</span>;
  if (delta.direction === 'flat') return <span className={LT.meta}>{dl.lcx2_peek_unchanged}</span>;
  return <DeltaMark delta={delta} />;
}

function Measured({ at, sha, template }: { at: string | null; sha: string | null; template: string }) {
  const { dl } = useLifecycleViewModel();
  if (!at) return null;
  const time = <RelativeTime timestamp={at} />;
  return <>{sha ? fillTemplate(template, { time, sha: <span className={LT.code}>{sha}</span> }) : fillTemplate(dl.lcx2_peek_measured_at, { time })}</>;
}

export function PeekBody({ step }: { step: HealthStep }) {
  const { dl } = useLifecycleViewModel();
  const change = stepChange(step);
  const reason = reasonLine(dl, step.health, step.reason);
  const prev = step.previous;
  const prevFigure = step.figure && prev ? prev.metrics.find((m) => m.key === step.figure!.key) ?? null : null;
  return (
    <div className="flex w-[26rem] max-w-full flex-col gap-2 py-1" data-testid="lc1-peek" data-step={step.node.id}>
      <div className="flex items-center justify-between gap-3">
        <span className={`truncate ${LT.title}`}>{stepLabel(dl, step.node.id, step.node.label)}</span>
        <VerdictPill health={step.health} />
      </div>
      {reason && <p className={LT.row}>{reason}</p>}
      {step.metrics.length > 0 && (
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-1">
          {step.metrics.map((m) => (
            <div key={m.key} className="contents" data-metric={m.key}>
              <span className={LT.label}>{metricLabel(dl, m.key)}</span>
              <MetricValue metric={m} className={`${LT.rowNum} text-right`} />
              <span className="text-right"><SampleNote metric={m} /></span>
              <Change delta={change?.metrics.find((d) => d.key === m.key)} known={!!prev} />
            </div>
          ))}
        </div>
      )}
      {step.measuredAt && (
        <p className={LT.meta}>
          <Measured at={step.measuredAt} sha={short(step.headSha)} template={dl.lcx1_fresh_measured} />
        </p>
      )}
      {prev && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="lc1-peek-previous">
          <span className={LT.label}>{dl.lcx2_peek_earlier}</span>
          <VerdictPill health={prev.health} />
          {prevFigure && step.figure && (
            <MetricValue metric={{ ...step.figure, value: prevFigure.value, samples: prevFigure.samples }} className={LT.rowNum} />
          )}
          <span className={LT.meta}>
            <Measured at={prev.measuredAt} sha={short(prev.headSha)} template={dl.lcx1_fresh_measured} />
          </span>
        </div>
      )}
      <PeekEvidence step={step} />
    </div>
  );
}
