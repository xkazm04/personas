/**
 * The focused project's steps as its planes draw them, with health joined in.
 *
 * While a Measure runs (`measure/measureSession`) the steps it measures hold
 * the verdict they had BEFORE it: a run row landing mid-Measure must not move
 * a column to a half-measured verdict. They carry their `measuring` tally
 * instead, and once the Measure ends the steps whose verdict it changed are
 * `settled`. Viewing a past Measure (`history/timeTravel`), Gate and Tests are
 * drawn as judged then and every other step as it is now. Nothing is
 * refetched for either.
 */
import { useMemo, useRef } from 'react';

import type { LifecycleStepHealthView } from '@/lib/bindings/LifecycleStepHealthView';

import { useLifecycleViewModel } from '../../context';
import { travelHealth } from '../../history/historyModel';
import { useTimeTravel } from '../../history/timeTravel';
import { joinHealth, type HealthStep } from '../../layer1/healthModel';
import { changedVerdicts, measuringSteps, type Tally } from '../../measure/measureModel';
import { isMeasuring, useMeasureSession } from '../../measure/measureSession';

export interface ProjectSteps {
  steps: HealthStep[];
  /** Steps a running Measure is measuring, with their command tally; empty when none runs. */
  measuring: ReadonlyMap<string, Tally>;
  /** Steps whose verdict the Measure that just ended changed. */
  settled: ReadonlySet<string>;
}

const NONE = new Map<string, Tally>();
const NO_STEPS = new Set<string>();

/** The rows now, with every measuring step held at its row from before the Measure. */
export function holdMeasuring(
  now: LifecycleStepHealthView[],
  before: LifecycleStepHealthView[] | null,
  measuring: ReadonlyMap<string, Tally>,
): LifecycleStepHealthView[] {
  if (!before || measuring.size === 0) return now;
  return now.map((row) => (measuring.has(row.stepId) ? before.find((b) => b.stepId === row.stepId) ?? row : row));
}

export function useProjectSteps(): ProjectSteps {
  const { snapshot, order } = useLifecycleViewModel();
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
  const held = useMemo(
    () => holdMeasuring(snapshot?.health ?? [], session.before?.health ?? null, measuring),
    [snapshot?.health, session.before, measuring],
  );
  // The time cursor matters only while a past Measure is viewed: a history refetch while at now
  // must not rebuild the steps.
  const viewing = viewedIndex !== null && !!history;
  const health = useMemo(
    () => (viewing ? travelHealth(held, columns, viewedIndex!, history!.stepIds) : held),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [held, viewing, viewing ? columns : null, viewing ? viewedIndex : null, viewing ? history : null],
  );
  // `joinHealth` keeps each step object per health row; keep the array too when every step is the
  // same, so a revision that brought the same data back re-renders no column.
  const last = useRef<HealthStep[] | null>(null);
  const steps = useMemo(() => {
    const next = joinHealth(order, health);
    const prev = last.current;
    if (prev && prev.length === next.length && prev.every((s, i) => s === next[i])) return prev;
    last.current = next;
    return next;
  }, [order, health]);
  return useMemo(() => ({ steps, measuring, settled }), [steps, measuring, settled]);
}
