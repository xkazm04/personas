// The band's third line. Now: when and on which commit the step was measured,
// how its figure moved since the earlier measure (the wave-2 helper,
// `layer1/delta`) and its lane; the verdict it had, when that changed, sits by
// the verdict pill on the title line. While a past Measure is viewed: which
// Measure the band shows, in the accent, as Layer 1's status band says it (the
// way back is on the band's history strip). A step the history does not track
// says it is shown as it is now.
import type { ReactNode } from 'react';
import { History } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { shortSha } from '../../frame/freshness';
import { useTimeTravel } from '../../history/timeTravel';
import { stepChange } from '../../layer1/delta';
import type { HealthStep } from '../../layer1/healthModel';
import { healthPhrase } from '../../layer1/layer1Labels';
import { DeltaMark } from '../../layer1/rail/DeltaMark';
import { BAND } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import type { StepTravel } from '../useShownStep';

/** The travel lead: which Measure the band shows. Its way back sits on the history strip that picked it. */
function TravelLine() {
  const { dl } = useLifecycleViewModel();
  const { viewing } = useTimeTravel();
  if (!viewing) return null;
  return (
    <p className={`min-w-0 text-primary ${LT.meta}`} data-testid="lc2-band-travel" data-measure={viewing.measureId}>
      {fillTemplate(dl.lcx3_viewing, {
        time: <RelativeTime timestamp={viewing.finishedAt} />,
        sha: <span className={LT.code}>{shortSha(viewing.headSha)}</span>,
      })}
    </p>
  );
}

export function BandMeta({ step, travel }: { step: HealthStep; travel: StepTravel }) {
  const { dl, tx } = useLifecycleViewModel();
  if (travel === 'then') return <TravelLine />;
  const { node } = step;
  const change = stepChange(step);
  const moved = change?.figure && change.figure.direction !== 'flat' ? change.figure : null;
  // Each part keeps its separator with it (a wrapped line never starts on a lone dot). While the
  // band is narrow the line keeps only what fits one line: the delta moves beside the hero figure
  // and the lane is left to the mini-map, which draws the lanes; both come back when it is wide.
  const parts: { key: string; node: ReactNode; wideOnly?: boolean }[] = [];
  if (step.measuredAt) {
    parts.push({
      key: 'measured',
      node: fillTemplate(step.headSha ? dl.lcx1_fresh_measured : dl.lcx2_peek_measured_at, {
        time: <RelativeTime timestamp={step.measuredAt} />,
        sha: step.headSha ? <span className={LT.code}>{shortSha(step.headSha)}</span> : null,
      }),
    });
  }
  if (step.staleOf) parts.push({ key: 'stale', node: <span className="text-status-info">{tx(dl.lc2_stale_of, { health: healthPhrase(dl, step.staleOf) })}</span> });
  // The mark says "since the earlier measure" to a reader; on screen the arrow and the sign say it.
  if (moved) parts.push({ key: 'delta', node: <span data-testid="lc2-band-delta"><DeltaMark delta={moved} /></span>, wideOnly: true });
  if (travel === 'untracked') {
    parts.push({
      key: 'untracked',
      node: (
        <span className="inline-flex items-center gap-1.5 text-primary" data-testid="lc2-band-untracked">
          <History className={`${GLYPH.sm} shrink-0`} aria-hidden />
          {dl.lcx3_not_tracked}
        </span>
      ),
    });
  }
  parts.push({ key: 'lane', node: node.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after, wideOnly: true });
  return (
    <p className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 ${LT.meta}`} data-testid="lc2-band-meta">
      {parts.map((part, i) => (
        <span key={part.key} className={`items-baseline gap-2 whitespace-nowrap ${part.wideOnly ? BAND.wideOnly : 'inline-flex'}`}>
          {i > 0 && <span aria-hidden>·</span>}
          <span>{part.node}</span>
        </span>
      ))}
    </p>
  );
}
