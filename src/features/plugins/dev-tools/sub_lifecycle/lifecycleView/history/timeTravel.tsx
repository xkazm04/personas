/**
 * TIME TRAVEL: the page's one time cursor. Layer 1 shows NOW (the snapshot)
 * unless a past Measure is being viewed; then the rail's Gate and Tests cards,
 * the status band and the history figure all show that Measure, and every
 * other step is drawn dimmed as it is now. Layer 2's Gate and Tests strips
 * read and move the same cursor, so a Measure picked on a step's screen is the
 * one Layer 1 shows on return, and the other way round.
 *
 * Mounted above both layers (`LifecycleBody`). Nothing is refetched to travel:
 * the history payload holds every Measure's cells and runs.
 *
 * Esc returns to now, on the app's keyboard ladder at the default rung (Layer
 * 2's own Esc, at the route rung, still goes back to Layer 1 first), and only
 * while a past Measure is viewed. A project switch, or a history that no
 * longer holds the viewed Measure, returns to now.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { LifecycleHistory } from '@/lib/bindings/LifecycleHistory';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import { timeline } from './historyModel';
import { useLifecycleHistory } from './useLifecycleHistory';

export interface TimeTravel {
  history: LifecycleHistory | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Every Measure, oldest first: the drawing order. */
  columns: LifecycleMeasureColumn[];
  /** The steps history judges (gate, tests). */
  tracked: ReadonlySet<string>;
  /** Index into `columns` of the viewed Measure; null = now. Never the newest. */
  viewedIndex: number | null;
  viewing: LifecycleMeasureColumn | null;
  /** View a Measure by id; null, or the newest Measure, returns to now. */
  travel: (measureId: string | null) => void;
}

const NONE: TimeTravel = {
  history: null, loading: false, error: null, refetch: () => {}, columns: [], tracked: new Set(),
  viewedIndex: null, viewing: null, travel: () => {},
};

const TimeTravelContext = createContext<TimeTravel>(NONE);

export function TimeTravelProvider({ projectId, ready, children }: { projectId: string | null; ready: boolean; children: ReactNode }) {
  const { history, loading, error, refetch } = useLifecycleHistory(projectId, ready);
  const [viewedId, setViewedId] = useState<string | null>(null);

  useEffect(() => { setViewedId(null); }, [projectId]);

  const columns = useMemo(() => timeline(history), [history]);
  const tracked = useMemo(() => new Set(history?.stepIds ?? []), [history]);
  const found = viewedId ? columns.findIndex((c) => c.measureId === viewedId) : -1;
  // The newest Measure is now; a Measure the history no longer holds is now too.
  const viewedIndex = found >= 0 && found < columns.length - 1 ? found : null;

  const travel = useCallback((measureId: string | null) => setViewedId(measureId), []);

  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return false;
    setViewedId(null);
    return true;
  }, { enabled: viewedIndex !== null });

  const value = useMemo<TimeTravel>(() => ({
    history, loading, error, refetch, columns, tracked,
    viewedIndex, viewing: viewedIndex !== null ? columns[viewedIndex] ?? null : null, travel,
  }), [history, loading, error, refetch, columns, tracked, viewedIndex, travel]);

  return <TimeTravelContext.Provider value={value}>{children}</TimeTravelContext.Provider>;
}

/** The time cursor in force (now, with no history, outside a provider). */
export function useTimeTravel(): TimeTravel {
  return useContext(TimeTravelContext);
}

/** Whether a step is drawn as it is NOW while a past Measure is viewed (it is not in the history). */
export function isUntracked(t: TimeTravel, stepId: string): boolean {
  return t.viewing !== null && !t.tracked.has(stepId);
}
