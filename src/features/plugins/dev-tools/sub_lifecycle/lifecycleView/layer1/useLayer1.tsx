// What the Layer-1 collar rail reads: the two lanes with health joined in, and the
// rail's roving keyboard (one tab stop, arrows walk the journey, selection
// moves with focus). `StepTrack` is the toolbar that owns the arrow keys.
//
// While a Measure runs (`measure/measureSession`) the steps it measures hold
// the verdict they had BEFORE it: a run row landing mid-Measure must not move
// a card to a half-measured verdict. They carry their `measuring` tally
// instead, and once the Measure ends the steps whose verdict it changed are
// `settled` (their card animates the change once).
import { useMemo, type ReactNode } from 'react';

import type { LifecycleStepHealthView } from '@/lib/bindings/LifecycleStepHealthView';

import { useStepRoving, type StepRoving } from '../blocks/useStepRoving';
import { useLifecycleViewModel } from '../context';
import { travelHealth } from '../history/historyModel';
import { useTimeTravel } from '../history/timeTravel';
import { changedVerdicts, measuringSteps, type Tally } from '../measure/measureModel';
import { isMeasuring, useMeasureSession } from '../measure/measureSession';
import { joinHealth, type HealthStep } from './healthModel';

export interface Layer1Data {
  before: HealthStep[];
  after: HealthStep[];
  all: HealthStep[];
  roving: StepRoving;
  /** Steps a running Measure is measuring, with their command tally; empty when none runs. */
  measuring: ReadonlyMap<string, Tally>;
  /** Steps whose verdict the Measure that just ended changed. */
  settled: ReadonlySet<string>;
}

const NONE = new Map<string, Tally>();
const NO_STEPS = new Set<string>();

/** The rows now, with every measuring step held at its row from before the Measure. */
function holdMeasuring(now: LifecycleStepHealthView[], before: LifecycleStepHealthView[] | null, measuring: ReadonlyMap<string, Tally>) {
  if (!before || measuring.size === 0) return now;
  return now.map((row) => (measuring.has(row.stepId) ? before.find((b) => b.stepId === row.stepId) ?? row : row));
}

export function useLayer1(): Layer1Data {
  const { snapshot, lanes, order, selected, select } = useLifecycleViewModel();
  const { columns, viewedIndex, history } = useTimeTravel();
  const session = useMeasureSession();
  const under = isMeasuring(session.phase);
  const measuring = useMemo(
    () => (under && snapshot ? measuringSteps(session.progress, snapshot.rules) : NONE),
    [under, snapshot, session.progress],
  );
  const settled = useMemo(() => {
    if (session.phase !== 'ended' || !session.open || !session.after) return NO_STEPS;
    return changedVerdicts(session.before, session.after, session.after.rules.stepKinds.map((s) => s.stepId));
  }, [session.phase, session.open, session.before, session.after]);
  // Viewing a past Measure: Gate and Tests as judged then (with the Measure before it as their
  // `previous`), every other step as it is now. Nothing is refetched.
  const health = useMemo(() => {
    const now = snapshot?.health;
    if (!now) return now;
    const held = holdMeasuring(now, session.before?.health ?? null, measuring);
    if (viewedIndex === null || !history) return held;
    return travelHealth(held, columns, viewedIndex, history.stepIds);
  }, [snapshot?.health, session.before, measuring, columns, viewedIndex, history]);
  const before = useMemo(() => joinHealth(lanes.before, health ?? []), [lanes.before, health]);
  const after = useMemo(() => joinHealth(lanes.after, health ?? []), [lanes.after, health]);
  const all = useMemo(() => [...before, ...after], [before, after]);
  const roving = useStepRoving(order, selected?.id ?? null, select);
  return { before, after, all, roving, measuring, settled };
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
