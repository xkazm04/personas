/** useBuildClock - the honest clock behind the slate and the bottom rail.
 *
 *  Time is recorded as segments of what the build was waiting on: the model
 *  ("llm", only while `isBuilding` is true), the user ("you", while questions
 *  are open) and the test run ("test"). A segment opens when its kind becomes
 *  current and closes when it stops being current, so the rail never shows
 *  progress that did not happen. The 1 s tick runs only while a segment is
 *  open; an idle sheet does not re-render. */
import { useEffect, useMemo, useState } from "react";

export type ClockKind = "llm" | "you" | "test";

export interface ClockSegment {
  kind: ClockKind;
  start: number;
  end: number | null;
}

export interface BuildClock {
  segments: ClockSegment[];
  now: number;
  totals: Record<ClockKind, number>;
  /** Seconds of the currently open segment (0 when none is open). */
  openSecs: number;
  /** Seconds the first model turn took, once it closed. */
  firstPassSecs: number | null;
}

export function useBuildClock(kind: ClockKind | null, resetKey: string | null): BuildClock {
  const [segments, setSegments] = useState<ClockSegment[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setSegments([]); }, [resetKey]);

  useEffect(() => {
    const ts = Date.now();
    setNow(ts);
    setSegments((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.end === null && last.kind === kind) return prev;
      const closed = last && last.end === null ? [...prev.slice(0, -1), { ...last, end: ts }] : prev;
      return kind ? [...closed, { kind, start: ts, end: null }] : closed;
    });
  }, [kind, resetKey]);

  const open = kind !== null;
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  return useMemo(() => {
    const totals: Record<ClockKind, number> = { llm: 0, you: 0, test: 0 };
    for (const s of segments) totals[s.kind] += Math.max(0, ((s.end ?? now) - s.start) / 1000);
    const last = segments[segments.length - 1];
    const openSecs = last && last.end === null ? Math.max(0, (now - last.start) / 1000) : 0;
    const first = segments.find((s) => s.kind === "llm");
    const firstPassSecs = first && first.end !== null ? (first.end - first.start) / 1000 : null;
    return { segments, now, totals, openSecs, firstPassSecs };
  }, [segments, now]);
}

/** 83 -> "01:23" (timecode, tabular). */
export function timecode(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 83 -> "1 min 23 s"; 42 -> "42 s". */
export function spokenSecs(secs: number): string {
  const s = Math.round(secs);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
