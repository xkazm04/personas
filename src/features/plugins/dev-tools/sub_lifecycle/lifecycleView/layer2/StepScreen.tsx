/**
 * LAYER 2 - one step's own screen, shown IN PLACE of Layer 1 on the same page
 * (not a modal, not a route): the trail back, the step large with its
 * verdict and its metrics around its icon, then the preset for its kind of
 * step, then its rule and bindings.
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
import { useEffect, useMemo, useRef } from 'react';

import { Banner } from '@/features/shared/components/feedback/Banner';

import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { joinHealth } from '../layer1/healthModel';
import { DocsPreset } from '../presets/DocsPreset';
import { GatePreset, type PresetData } from '../presets/GatePreset';
import { GenericPreset } from '../presets/GenericPreset';
import { TestsPreset } from '../presets/TestsPreset';
import { StepHeader } from './StepHeader';
import { StepRule } from './StepRule';
import { useStepDetail } from './useStepDetail';
import { useStepKeys } from './useStepKeys';

/** Steps whose preset needs `getLifecycleStepDetail`. */
const DETAIL_STEPS: ReadonlySet<string> = new Set(['gate', 'tests', 'docs']);

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
    <div className="space-y-8" data-testid="lc2-screen" data-step={node.id}>
      <StepHeader ref={titleRef} step={step} prev={prev} next={next} />
      {error && <Banner severity="error" compact message={dl.lc2_detail_failed} cause={error} onRetry={refetch} />}
      {node.id === 'gate' && <GatePreset key={node.id} node={node} data={data} />}
      {node.id === 'tests' && <TestsPreset key={node.id} step={step} node={node} data={data} />}
      {node.id === 'docs' && <DocsPreset key={node.id} step={step} node={node} data={data} />}
      {!DETAIL_STEPS.has(node.id) && <GenericPreset key={node.id} step={step} node={node} />}
      <StepRule node={node} />
    </div>
  );
}
