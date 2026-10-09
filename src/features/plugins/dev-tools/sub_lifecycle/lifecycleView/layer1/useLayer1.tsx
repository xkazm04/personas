// What the Layer-1 collar rail reads: the two lanes with health joined in, and the
// rail's roving keyboard (one tab stop, arrows walk the journey, selection
// moves with focus). `StepTrack` is the toolbar that owns the arrow keys.
import { useMemo, type ReactNode } from 'react';

import { useStepRoving, type StepRoving } from '../blocks/useStepRoving';
import { useLifecycleViewModel } from '../context';
import { travelHealth } from '../history/historyModel';
import { useTimeTravel } from '../history/timeTravel';
import { joinHealth, type HealthStep } from './healthModel';

export interface Layer1Data {
  before: HealthStep[];
  after: HealthStep[];
  all: HealthStep[];
  roving: StepRoving;
}

export function useLayer1(): Layer1Data {
  const { snapshot, lanes, order, selected, select } = useLifecycleViewModel();
  const { columns, viewedIndex, history } = useTimeTravel();
  // Viewing a past Measure: Gate and Tests as judged then (with the Measure before it as their
  // `previous`), every other step as it is now. Nothing is refetched.
  const health = useMemo(() => {
    const now = snapshot?.health;
    if (!now || viewedIndex === null || !history) return now;
    return travelHealth(now, columns, viewedIndex, history.stepIds);
  }, [snapshot?.health, columns, viewedIndex, history]);
  const before = useMemo(() => joinHealth(lanes.before, health ?? []), [lanes.before, health]);
  const after = useMemo(() => joinHealth(lanes.after, health ?? []), [lanes.after, health]);
  const all = useMemo(() => [...before, ...after], [before, after]);
  const roving = useStepRoving(order, selected?.id ?? null, select);
  return { before, after, all, roving };
}

export function StepTrack({ roving, className = '', children }: { roving: StepRoving; className?: string; children: ReactNode }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      aria-label={dl.lc_journey_label}
      onKeyDown={roving.onKeyDown}
      className={className}
      data-testid="lc-journey-track"
    >
      {children}
    </div>
  );
}
