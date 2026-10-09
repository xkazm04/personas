/**
 * LAYER 2 - one step's own screen, shown IN PLACE of Layer 1 on the same page
 * (not a modal, not a route), top to bottom:
 *
 * - the MINI-MAP (`nav/StepMap`): the way back and every step as a pin in lane
 *   order, this one raised and labelled; a pin opens its step;
 * - the BAND (`band/StepBand`): the step as one compact object - its key, its
 *   verdict and why, its instrument, and for Gate and Tests its own history -
 *   showing the Measure the page's time cursor is on;
 * - NEXT (`next/NextPanel`): what to do about the step now, most impact first;
 * - the preset for its kind of step, its rule and bindings;
 * - the backlog items about it (`related/RelatedItems`), when there are any.
 *
 * Code: this screen and each preset are their own chunks (`stepChunks`), warmed
 * on intent and in idle time. The band paints as soon as this chunk is in; the
 * preset suspends into `PresetGhost`, a delayed ghost of one section.
 *
 * Keyboard: Esc returns to Layer 1 (the page restores focus to the step's key
 * and the rail's scroll); Left / Right, or a pin, walk to another step's
 * screen without returning. Focus lands on the step's title each time a screen
 * opens, so a reader hears where they are.
 *
 * Data: every step reads its detail (`useStepDetail`): the runs or doc rows its
 * preset draws, and the backlog items and evidence behind Next and the related
 * list. A detail failure is an inline banner over a screen that still draws
 * everything the snapshot knows.
 */
import { Suspense, useEffect, useRef } from 'react';

import { Banner } from '@/features/shared/components/feedback/Banner';

import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import type { HealthStep } from '../layer1/healthModel';
import type { PresetData } from '../presets/presetData';
import { RHYTHM } from '../system/lcSurface';
import { StepBand } from './band/StepBand';
import { LazyDocsPreset, LazyGatePreset, LazyGenericPreset, LazyTestsPreset } from './lazySteps';
import { StepMap } from './nav/StepMap';
import { NextPanel } from './next/NextPanel';
import { useNextPlan } from './next/useNextPlan';
import { RelatedItemProvider } from './related/relatedItem';
import { RelatedItems } from './related/RelatedItems';
import { StepRule } from './StepRule';
import { PresetGhost } from './StepScreenGhost';
import { useShownStep } from './useShownStep';
import { useStepDetail } from './useStepDetail';
import { useStepKeys } from './useStepKeys';

function StepPreset({ step, node, data }: { step: HealthStep; node: JourneyNode; data: PresetData }) {
  if (node.id === 'gate') return <LazyGatePreset key={node.id} node={node} data={data} />;
  if (node.id === 'tests') return <LazyTestsPreset key={node.id} step={step} node={node} data={data} />;
  if (node.id === 'docs') return <LazyDocsPreset key={node.id} step={step} node={node} data={data} />;
  return <LazyGenericPreset key={node.id} step={step} node={node} />;
}

export function StepScreen({ node }: { node: JourneyNode }) {
  const { dl, projectId, order, openStep, closeStep } = useLifecycleViewModel();
  const shown = useShownStep(node);
  const index = order.findIndex((n) => n.id === node.id);
  const prev = index > 0 ? order[index - 1]! : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1]! : null;
  const { detail, loading, error, refetch } = useStepDetail(projectId, node.id);
  const data: PresetData = { detail, loading: loading && !detail, unavailable: !!error && !detail };
  const plan = useNextPlan(node, shown.now, detail);

  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [node.id]);

  useStepKeys({
    back: closeStep,
    prev: prev ? () => openStep(prev.id) : null,
    next: next ? () => openStep(next.id) : null,
  });

  return (
    <RelatedItemProvider onDecided={refetch}>
      <div className={RHYTHM.section} data-testid="lc2-screen" data-step={node.id}>
        {/* One block from the map to the preset's first section, so the first command row sits
            high (above y=560 at 1920x1080); the preset's own sections carry their own spacing. */}
        <div className={RHYTHM.block}>
          <StepMap node={node} />
          <StepBand ref={titleRef} node={node} shown={shown} />
          {error && <Banner severity="error" compact message={dl.lc2_detail_failed} cause={error} onRetry={refetch} />}
          <NextPanel node={node} plan={plan} />
          <Suspense fallback={<PresetGhost />}>
            <StepPreset step={shown.step} node={node} data={data} />
          </Suspense>
        </div>
        <StepRule node={node} />
        <RelatedItems items={detail?.related ?? []} />
      </div>
    </RelatedItemProvider>
  );
}
