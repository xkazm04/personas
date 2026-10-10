// The Next panel's plan for one step, from what the screen already holds: the
// step as it is NOW (a past Measure cannot be acted on, so the plan never
// travels), its params and the snapshot's rules, the step's detail and the
// Measure history (for a healthy streak). Pure work in `nextModel`.
import { useMemo } from 'react';

import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

import type { JourneyNode } from '../../../journey/journeyModel';
import { useTimeTravel } from '../../history/timeTravel';
import type { HealthStep } from '../../layer1/healthModel';
import { useSnapshotRules } from '../../system/useSnapshotRules';
import { nextPlan, type NextPlan } from './nextModel';

export function useNextPlan(node: JourneyNode, now: HealthStep, detail: LifecycleStepDetail | null): NextPlan {
  const rules = useSnapshotRules();
  const { columns } = useTimeTravel();
  const params = node.view.step.params;
  return useMemo(() => nextPlan({ step: now, params, rules, detail, columns }), [now, params, rules, detail, columns]);
}
