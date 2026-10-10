// What a step screen SHOWS: each step as judged now, or, while a past Measure
// is viewed (`history/timeTravel`), Gate and Tests as judged at that Measure -
// the same cells the rail draws on Layer 1, through the same `travelHealth`,
// so the two layers never disagree. A step the history does not track is
// shown as it is now and says so (`travel: 'untracked'`).
import { useMemo } from 'react';

import type { LifecycleStepHealthView } from '@/lib/bindings/LifecycleStepHealthView';

import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { travelHealth } from '../history/historyModel';
import { isUntracked, useTimeTravel } from '../history/timeTravel';
import { joinHealth, type HealthStep } from '../layer1/healthModel';

export type StepTravel = 'then' | 'untracked' | null;

export interface ShownStep {
  /** The step as the screen draws it (then, while travelling and tracked; now otherwise). */
  step: HealthStep;
  /** The step as it is now, whatever the time cursor says: what the Next panel acts on. */
  now: HealthStep;
  travel: StepTravel;
}

/** Every step's health row as the screen shows it: now, or with the tracked steps at the viewed Measure. */
export function useShownHealth(): LifecycleStepHealthView[] {
  const { snapshot } = useLifecycleViewModel();
  const { columns, viewedIndex, history } = useTimeTravel();
  const health = snapshot?.health;
  return useMemo(() => {
    const now = health ?? [];
    return viewedIndex === null || !history ? now : travelHealth(now, columns, viewedIndex, history.stepIds);
  }, [health, columns, viewedIndex, history]);
}

export function useShownStep(node: JourneyNode): ShownStep {
  const { snapshot } = useLifecycleViewModel();
  const tt = useTimeTravel();
  const shown = useShownHealth();
  const health = snapshot?.health;
  const untracked = isUntracked(tt, node.id);
  const then = tt.viewing !== null && !untracked;
  return useMemo(() => {
    const now = joinHealth([node], health ?? [])[0]!;
    if (!then) return { step: now, now, travel: untracked ? 'untracked' : null };
    return { step: joinHealth([node], shown)[0]!, now, travel: 'then' };
  }, [node, health, shown, then, untracked]);
}
