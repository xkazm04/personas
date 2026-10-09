/**
 * The top of a step's screen: the way back ("Lifecycle", a button with its
 * arrow) and the pipeline as a MINI-MAP: every step a pin (`MapPin`) in lane
 * order, the pins of a lane joined by the rail's pipe, the two lanes broken
 * apart, the current step raised and labelled. Pressing a pin opens that
 * step's screen; Left / Right still walk (`useStepKeys`), Esc goes back.
 *
 * The pins show each step as the screen shows it: while a past Measure is
 * viewed, Gate and Tests as judged then (`useShownHealth`), as on Layer 1.
 */
import { Fragment, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';

import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { joinHealth, type HealthStep } from '../../layer1/healthModel';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { useShownHealth } from '../useShownStep';
import { MapPin } from './MapPin';

function Lane({ title, steps, current, testId }: { title: string; steps: HealthStep[]; current: string; testId: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5" data-testid={testId}>
      <span className={`hidden whitespace-nowrap 2xl:inline ${LT.eyebrow}`} aria-hidden>{title}</span>
      <ol className="flex items-center" aria-label={title}>
        {steps.map((s, i) => (
          <Fragment key={s.node.id}>
            {i > 0 && <span aria-hidden className="block h-0.5 w-2 shrink-0 bg-primary/25" />}
            <MapPin step={s} current={s.node.id === current} />
          </Fragment>
        ))}
      </ol>
    </div>
  );
}

export function StepMap({ node }: { node: JourneyNode }) {
  const { dl, lanes, closeStep } = useLifecycleViewModel();
  const health = useShownHealth();
  const before = useMemo(() => joinHealth(lanes.before, health), [lanes.before, health]);
  const after = useMemo(() => joinHealth(lanes.after, health), [lanes.after, health]);
  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label={dl.lcx5_map_label} data-testid="lc2-map">
      <Button variant="secondary" size="sm" icon={<ArrowLeft className={GLYPH.sm} />} onClick={closeStep} data-testid="lc2-back">
        {dl.lc2_trail_root}
      </Button>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <Lane title={dl.lc_lane_before} steps={before} current={node.id} testId="lc2-map-before" />
        <span aria-hidden className="block h-6 w-px shrink-0 bg-primary/20" />
        <Lane title={dl.lc_lane_after} steps={after} current={node.id} testId="lc2-map-after" />
      </div>
    </nav>
  );
}
