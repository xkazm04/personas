/** useSheetClock — the honest build clock behind the film rail.
 *
 *  Starts the moment the build starts running (not at launch click, not at an
 *  estimate), never advances while nothing is working (draft on the table,
 *  verdict waiting for you), and remembers WHOSE time each stretch was: the
 *  build's, yours (answering questions) or the screening's. The rail paints
 *  those stretches in different stock so a slow build and a slow reader are
 *  told apart. Resets with the build session. */
import { useEffect, useRef, useState } from "react";

export type ClockMode = "build" | "you" | "test" | null;
export interface ClockMark { at: number; kind: Exclude<ClockMode, null> }

export function useSheetClock(sessionId: string | null, mode: ClockMode) {
  const [elapsed, setElapsed] = useState(0);
  const [marks, setMarks] = useState<ClockMark[]>([]);
  const baseRef = useRef(0);
  const sinceRef = useRef<number | null>(null);

  useEffect(() => {
    baseRef.current = 0;
    sinceRef.current = null;
    setElapsed(0);
    setMarks([]);
  }, [sessionId]);

  useEffect(() => {
    const bank = () => {
      if (sinceRef.current !== null) {
        baseRef.current += (performance.now() - sinceRef.current) / 1000;
        sinceRef.current = null;
      }
    };
    bank();
    if (!mode) {
      setElapsed(baseRef.current);
      return;
    }
    sinceRef.current = performance.now();
    const at = baseRef.current;
    setMarks((m) => (m.length && m[m.length - 1]!.kind === mode ? m : [...m, { at, kind: mode }]));
    const id = window.setInterval(() => {
      if (sinceRef.current === null) return;
      setElapsed(baseRef.current + (performance.now() - sinceRef.current) / 1000);
    }, 500);
    return () => {
      window.clearInterval(id);
      bank();
    };
  }, [mode, sessionId]);

  return { elapsed, marks, running: mode !== null };
}

/** Whose time was second `t`? */
export function kindAt(marks: ClockMark[], t: number): ClockMark["kind"] | null {
  let k: ClockMark["kind"] | null = null;
  for (const m of marks) {
    if (m.at <= t) k = m.kind;
    else break;
  }
  return k;
}
