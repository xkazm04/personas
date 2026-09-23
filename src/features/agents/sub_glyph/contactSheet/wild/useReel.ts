/** useReel: the act the build is in, and the honest reel clock.
 *
 *  The act is derived purely from real props (phase, pending questions, design
 *  result, error). The clock counts only real running time: it starts when the
 *  build starts (the session's `createdAt` when we mount mid-build, so a layout
 *  switch does not reset it), ticks once a second while the model or the test
 *  runner is working or waiting on you, and freezes when the draft is idle.
 *  Every second is attributed to who was holding the reel: the model, you
 *  (answering questions) or the test run. Nothing is extrapolated. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import type { BuildPhase } from "@/lib/types/buildTypes";

export type Act =
  | "compose" | "exposure" | "questions" | "wiring" | "draft"
  | "screening" | "verdict" | "premiere" | "fogged";

export const ACT_ORDER: Act[] = ["compose", "exposure", "questions", "wiring", "draft", "screening", "verdict", "premiere"];

export type Who = "model" | "you" | "test";
interface Seg { who: Who; start: number; end: number | null }

interface ActArgs {
  isCompose: boolean;
  isBuilding: boolean;
  buildPhase: BuildPhase | null;
  hasPending: boolean;
  hasDesignResult: boolean;
  buildError: string | null;
  answeredAny: boolean;
}

export function deriveAct(a: ActArgs): Act {
  if (a.isCompose) return "compose";
  if (a.buildPhase === "promoted") return "premiere";
  if (a.buildPhase === "failed" || a.buildPhase === "cancelled") return "fogged";
  if (a.buildError && !a.isBuilding && !a.hasDesignResult) return "fogged";
  if (a.hasPending) return "questions";
  if (a.buildPhase === "testing") return "screening";
  if (a.buildPhase === "test_complete") return "verdict";
  if (a.isBuilding) return a.buildPhase === "resolving" || a.answeredAny ? "wiring" : "exposure";
  if (a.hasDesignResult) return "draft";
  return "exposure";
}

const MOUNT_TRUST_MS = 30 * 60 * 1000;

export function useReelClock(act: Act, sessionId: string | null) {
  const createdAt = useAgentStore((s) =>
    s.activeBuildSessionId ? s.buildSessions[s.activeBuildSessionId]?.createdAt ?? null : null,
  );
  const who: Who | null =
    act === "exposure" || act === "wiring" ? "model"
      : act === "questions" ? "you"
        : act === "screening" ? "test"
          : null;

  const [segs, setSegs] = useState<Seg[]>([]);
  const firstSeen = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  // New session: a fresh reel.
  useEffect(() => { setSegs([]); firstSeen.current = false; setNow(Date.now()); }, [sessionId]);

  // Open / close segments as the holder of the reel changes.
  useEffect(() => {
    const t = Date.now();
    // First segment of a build we joined late: start from the real launch.
    const lateStart = !firstSeen.current && who === "model" && createdAt !== null
      && t - createdAt > 0 && t - createdAt < MOUNT_TRUST_MS;
    if (who) firstSeen.current = true;
    setSegs((prev) => {
      const open = prev[prev.length - 1];
      if (open && open.end === null && open.who === who) return prev;
      const closed = open && open.end === null ? [...prev.slice(0, -1), { ...open, end: t }] : prev;
      return who ? [...closed, { who, start: lateStart && createdAt !== null ? createdAt : t, end: null }] : closed;
    });
    setNow(t);
  }, [who, createdAt]);

  // One tick per second, only while the reel is actually running.
  useEffect(() => {
    if (!who) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [who]);

  return useMemo(() => {
    const spans = segs.map((s) => ({ who: s.who, secs: Math.max(0, ((s.end ?? now) - s.start) / 1000) }));
    const total = spans.reduce((n, s) => n + s.secs, 0);
    // The first model take, for the "usual window" bracket.
    const firstTake = spans[0]?.who === "model" ? spans[0].secs : 0;
    return { spans, total, firstTake, running: who !== null, who };
  }, [segs, now, who]);
}

export function timecode(secs: number): string {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(r)}`;
}

/** Tracks whether this session has answered any question (drives exposure vs
 *  wiring) and how many, for an overflow-safe "Question i of n". The ref makes
 *  the duplicate check synchronous, so two presses inside one frame still
 *  answer once. */
export function useAnswerLedger(sessionId: string | null) {
  const [answered, setAnswered] = useState<string[]>([]);
  const seen = useRef(new Set<string>());
  useEffect(() => { seen.current = new Set(); setAnswered([]); }, [sessionId]);
  const mark = useCallback((id: string) => {
    seen.current.add(id);
    setAnswered((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const has = useCallback((id: string) => seen.current.has(id), []);
  return { answered, mark, has };
}
