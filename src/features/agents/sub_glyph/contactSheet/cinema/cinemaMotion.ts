/** Cinema choreography hooks (`useCasting`, `useTimedReveal`), carried over
 *  from the retired GlyphCinemaLayout with the same contract. They could move
 *  into `cinemaShared.tsx` next to the silhouette they drive. */
import { useEffect, useState } from "react";
import { CINEMA_FORMS, CINEMA_PALETTE } from "@/features/agents/sub_glyph/cinemaShared";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const DEFAULT_ACCENT = CINEMA_PALETTE[0]!;

export interface Candidate { id: string; form: number; color: string }

export function makeCandidates(n: number): Candidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `sheet-cand-${i}`,
    form: i % CINEMA_FORMS.length,
    color: CINEMA_PALETTE[(i * 3) % CINEMA_PALETTE.length]!,
  }));
}

export type CastingPhase = "casting" | "deliberation" | "crowned";

/** Narrow the crowd to `floor` finalists over `castingMs`, then hold until
 *  `crown` flips (the real identity arrived, or the first pass landed). The
 *  hold is what lets the film cover an unbounded wait without running out. */
export function useCasting(ids: string[], crown: boolean, floor: number, castingMs: number, paused = false) {
  const maxToFloor = Math.max(0, ids.length - floor);
  const step = castingMs / Math.max(1, maxToFloor);
  const [discarded, setDiscarded] = useState(0);
  useEffect(() => { setDiscarded(0); }, [ids]);
  useEffect(() => {
    if (paused || crown || discarded >= maxToFloor) return;
    const h = window.setTimeout(() => setDiscarded((d) => d + 1), step);
    return () => window.clearTimeout(h);
  }, [discarded, maxToFloor, step, crown, paused]);

  const keep = crown ? 1 : ids.length - discarded;
  const phase: CastingPhase = crown ? "crowned" : discarded >= maxToFloor ? "deliberation" : "casting";
  return {
    phase,
    eliminated: new Set(ids.slice(keep)),
    finalists: new Set(ids.slice(0, Math.max(keep, 1))),
    winner: crown ? ids[0] ?? null : null,
  };
}

/** Reveal items one per beat so a burst of real data still arrives in time. */
export function useTimedReveal<T>(items: readonly T[], intervalMs: number, immediate = false): T[] {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (immediate) return;
    if (shown >= items.length) return;
    const h = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 120 : intervalMs);
    return () => window.clearTimeout(h);
  }, [shown, items.length, intervalMs, immediate]);
  return items.slice(0, immediate ? items.length : Math.min(shown, items.length));
}
