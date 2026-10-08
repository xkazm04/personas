/**
 * LAYER 2 - one step's own screen, shown IN PLACE of Layer 1 on the same page
 * (not a modal, not a route): the trail back, the step large with its
 * verdict and its metrics around its icon, then the preset for its kind of
 * step, then its rule and bindings.
 *
 * Code: this screen and each preset are their own chunks (`stepChunks`), warmed
 * on intent and in idle time. The header paints as soon as this chunk is in;
 * the preset suspends into `PresetGhost`, a delayed ghost of one section.
 *
 * Keyboard: Esc returns to Layer 1 (the page restores focus to the step's
 * key); Left / Right, or the two buttons by the trail, walk to the
 * neighbouring step's screen without returning. Focus lands on the step's
 * title each time a screen opens, so a reader hears where they are.
 *
 * Data: the gate / tests / docs presets read the step detail
 * (`useStepDetail`); every other step reads the snapshot only and fetches
 * nothing. A detail failure is an inline banner over a preset that still
 * draws everything the snapshot knows.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react';

import { Banner } from '@/features/shared/components/feedback/Banner';

import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { joinHealth, type HealthStep } from '../layer1/healthModel';
import type { PresetData } from '../presets/presetData';
import { RHYTHM } from '../system/lcSurface';
import { LazyDocsPreset, LazyGatePreset, LazyGenericPreset, LazyTestsPreset } from './lazySteps';
import { StepHeader } from './StepHeader';
import { StepRule } from './StepRule';
import { PresetGhost } from './StepScreenGhost';
import { DETAIL_STEPS } from './stepChunks';
import { useStepDetail } from './useStepDetail';
import { useStepKeys } from './useStepKeys';

function StepPreset({ step, node, data }: { step: HealthStep; node: JourneyNode; data: PresetData }) {
  if (node.id === 'gate') return <LazyGatePreset key={node.id} node={node} data={data} />;
  if (node.id === 'tests') return <LazyTestsPreset key={node.id} step={step} node={node} data={data} />;
  if (node.id === 'docs') return <LazyDocsPreset key={node.id} step={step} node={node} data={data} />;
  return <LazyGenericPreset key={node.id} step={step} node={node} />;
}

export function StepScreen({ node }: { node: JourneyNode }) {
  const { dl, projectId, snapshot, order, openStep, closeStep } = useLifecycleViewModel();
  const health = snapshot?.health;
  const step = useMemo(() => joinHealth([node], health ?? [])[0]!, [node, health]);
  const index = order.findIndex((n) => n.id === node.id);
  const prev = index > 0 ? order[index - 1]! : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1]! : null;
  const { detail, loading, error, refetch } = useStepDetail(projectId, DETAIL_STEPS.has(node.id) ? node.id : null);
  const data: PresetData = { detail, loading: loading && !detail, unavailable: !!error && !detail };

  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, [node.id]);

  useStepKeys({
    back: closeStep,
    prev: prev ? () => openStep(prev.id) : null,
    next: next ? () => openStep(next.id) : null,
  });

  return (
    <div className={RHYTHM.section} data-testid="lc2-screen" data-step={node.id}>
      <StepHeader ref={titleRef} step={step} prev={prev} next={next} />
      {error && <Banner severity="error" compact message={dl.lc2_detail_failed} cause={error} onRetry={refetch} />}
      <Suspense fallback={<PresetGhost />}>
        <StepPreset step={step} node={node} data={data} />
      </Suspense>
      <StepRule node={node} />
    </div>
  );
}
