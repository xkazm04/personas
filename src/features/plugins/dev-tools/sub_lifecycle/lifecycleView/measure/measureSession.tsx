/**
 * THE MEASURE SESSION: one running Measure as the page lives it, from the
 * snapshot stream alone (the snapshot refetches on every command start and
 * every run row, so nothing here polls).
 *
 * It remembers three things the snapshot forgets:
 *
 * - BEFORE: the last snapshot seen while nothing was measuring, so the rail
 *   can hold Gate and Tests at their old verdict until the Measure's last run
 *   lands, and the summary can say what changed;
 * - the LAST PROGRESS seen (the snapshot that ends a Measure carries none), so
 *   the panel can still show every command once it ended;
 * - AFTER: the first snapshot with the Measure over.
 *
 * Phases: idle -> preparing (measuring, the plan not yet resolved, so no
 * progress) -> running -> cancelling -> ended. An ended session keeps the panel
 * open for `LINGER_MS`, or until dismissed; a pointer resting on the panel or
 * focus inside it holds it open. A project switch forgets the session.
 *
 * Mounted around the whole page (`LifecyclePage`), so the header's control,
 * its subtitle and Layer 1 read one session.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { LifecycleMeasureProgress } from '@/lib/bindings/LifecycleMeasureProgress';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { useLifecycleViewModel } from '../context';

/** How long the panel stays after a Measure ends, unless held or dismissed. */
export const LINGER_MS = 8_000;

export type MeasurePhase = 'idle' | 'preparing' | 'running' | 'cancelling' | 'ended';

interface State {
  active: boolean;
  measureId: string | null;
  before: LifecycleSnapshot | null;
  progress: LifecycleMeasureProgress | null;
  after: LifecycleSnapshot | null;
  /** A cancel was asked for from this page (the snapshot may never show `cancelling`). */
  cancelAsked: boolean;
  dismissed: boolean;
}

const IDLE: State = { active: false, measureId: null, before: null, progress: null, after: null, cancelAsked: false, dismissed: false };

export interface MeasureSession {
  phase: MeasurePhase;
  /** The live progress, or the last seen once the Measure ended. */
  progress: LifecycleMeasureProgress | null;
  before: LifecycleSnapshot | null;
  after: LifecycleSnapshot | null;
  cancelled: boolean;
  /** The panel shows: a Measure runs, or ended and has not been dismissed. */
  open: boolean;
  dismiss: () => void;
  /** Hold the ended panel open (pointer on it, focus in it); releasing restarts the linger. */
  hold: (on: boolean) => void;
  /** This page asked to cancel (the control calls it before the API answers; false again when the ask failed). */
  markCancelAsked: (on: boolean) => void;
}

/** The next session state for one snapshot. Exported for the unit test. */
export function nextState(s: State, snap: LifecycleSnapshot, lastIdle: LifecycleSnapshot | null): State {
  if (snap.measuring) {
    const pid = snap.progress?.measureId ?? null;
    const another = pid !== null && s.measureId !== null && pid !== s.measureId;
    if (!s.active || s.after !== null || another) {
      return { ...IDLE, active: true, measureId: pid, before: lastIdle, progress: snap.progress };
    }
    return { ...s, measureId: s.measureId ?? pid, progress: snap.progress ?? s.progress };
  }
  if (s.active && s.after === null) return { ...s, after: snap };
  return s;
}

export function phaseOf(s: State): MeasurePhase {
  if (!s.active) return 'idle';
  if (s.after) return 'ended';
  if (!s.progress) return 'preparing';
  return s.progress.cancelling || s.cancelAsked ? 'cancelling' : 'running';
}

const NONE: MeasureSession = {
  phase: 'idle', progress: null, before: null, after: null, cancelled: false, open: false,
  dismiss: () => {}, hold: () => {}, markCancelAsked: () => {},
};

const MeasureSessionContext = createContext<MeasureSession>(NONE);

export function MeasureSessionProvider({ children }: { children: ReactNode }) {
  const { projectId, snapshot } = useLifecycleViewModel();
  const [state, setState] = useState<State>(IDLE);
  const [held, setHeld] = useState(false);
  const lastIdle = useRef<LifecycleSnapshot | null>(null);

  useEffect(() => {
    setState(IDLE);
    lastIdle.current = null;
  }, [projectId]);

  useEffect(() => {
    if (!snapshot) return;
    setState((s) => nextState(s, snapshot, lastIdle.current));
    if (!snapshot.measuring) lastIdle.current = snapshot;
  }, [snapshot]);

  const ended = state.active && state.after !== null && !state.dismissed;
  useEffect(() => {
    if (!ended || held) return;
    const id = setTimeout(() => setState((s) => ({ ...s, dismissed: true })), LINGER_MS);
    return () => clearTimeout(id);
  }, [ended, held]);

  const dismiss = useCallback(() => setState((s) => (s.after ? { ...s, dismissed: true } : s)), []);
  const hold = useCallback((on: boolean) => setHeld(on), []);
  const markCancelAsked = useCallback((on: boolean) => setState((s) => (s.active ? { ...s, cancelAsked: on } : s)), []);

  const value = useMemo<MeasureSession>(() => ({
    phase: phaseOf(state),
    progress: state.progress,
    before: state.before,
    after: state.after,
    cancelled: !!state.progress?.cancelling || state.cancelAsked,
    open: state.active && !state.dismissed,
    dismiss, hold, markCancelAsked,
  }), [state, dismiss, hold, markCancelAsked]);

  return <MeasureSessionContext.Provider value={value}>{children}</MeasureSessionContext.Provider>;
}

/** The Measure session in force (idle outside a provider). */
export function useMeasureSession(): MeasureSession {
  return useContext(MeasureSessionContext);
}

/** A Measure is under way (the plan resolving, running or cancelling). */
export function isMeasuring(phase: MeasurePhase): boolean {
  return phase === 'preparing' || phase === 'running' || phase === 'cancelling';
}
