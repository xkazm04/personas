// How an ended Measure came out, for the panel's footer and the live region:
// each command's outcome (the last progress completed from the Measure's own
// history column, `measureModel.finalCommands`), what the Measure changed
// (`measureModel.measureChange`, the history's delta), the failures to name,
// and how many commands a cancel left unrun. Null until the session ends.
//
// Reads the time cursor's history, so it is used under `TimeTravelProvider`.
import { useMemo } from 'react';

import type { LifecycleCommandProgress } from '@/lib/bindings/LifecycleCommandProgress';

import type { ChangeFragment } from '../history/historyModel';
import { useTimeTravel } from '../history/timeTravel';
import { finalCommands, measureChange, measureTookMs } from './measureModel';
import { useMeasureSession } from './measureSession';

export interface MeasureOutcome {
  measureId: string | null;
  commands: LifecycleCommandProgress[];
  fragments: ChangeFragment[];
  /** Failed or timed-out commands, in plan order: the ones the footer names. */
  failures: LifecycleCommandProgress[];
  /** Commands a cancel left unrun (0 when not cancelled). */
  notRun: number;
  cancelled: boolean;
  tookMs: number;
}

export function useMeasureOutcome(): MeasureOutcome | null {
  const { phase, progress, before, after, cancelled } = useMeasureSession();
  const { history } = useTimeTravel();
  return useMemo(() => {
    if (phase !== 'ended' || !after) return null;
    const measureId = progress?.measureId ?? null;
    const column = measureId ? history?.measures.find((m) => m.measureId === measureId) ?? null : null;
    const commands = finalCommands(progress, column, cancelled);
    const stepIds = after.rules.stepKinds.map((s) => s.stepId);
    return {
      measureId,
      commands,
      fragments: measureChange(before, after, stepIds),
      failures: commands.filter((c) => c.outcome === 'failed' || c.outcome === 'timeout'),
      notRun: cancelled ? commands.filter((c) => c.outcome === 'did_not_run').length : 0,
      cancelled,
      tookMs: measureTookMs(commands),
    };
  }, [phase, progress, before, after, cancelled, history]);
}
