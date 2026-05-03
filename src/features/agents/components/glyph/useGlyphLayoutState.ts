import { useEffect, useMemo } from "react";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { BuildQuestion, CellBuildStatus } from "@/lib/types/buildTypes";
import { CELL_KEY_TO_DIM, derivePetalState } from "./glyphLayoutHelpers";
import type { PetalState } from "./glyphLayoutTypes";

interface UseGlyphLayoutStateArgs {
  pendingQuestions: BuildQuestion[] | null;
  cellStates: Record<string, CellBuildStatus>;
  activeRow: GlyphRow | null;
  activeDim: GlyphDimension | null;
  setActiveDim: (d: GlyphDimension | null) => void;
}

export function useGlyphLayoutState({
  pendingQuestions, cellStates, activeRow, activeDim, setActiveDim,
}: UseGlyphLayoutStateArgs) {
  const pendingDims = useMemo(() => {
    const s = new Set<GlyphDimension>();
    for (const q of pendingQuestions ?? []) {
      const d = CELL_KEY_TO_DIM[q.cellKey];
      if (d) s.add(d);
    }
    return s;
  }, [pendingQuestions]);

  const petalStates = useMemo(() => {
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      out[dim] = derivePetalState(dim, cellStates, pendingDims, activeRow);
    }
    return out;
  }, [cellStates, pendingDims, activeRow]);

  // Auto-focus the next pending question's petal whenever there's no
  // card open. Fires:
  //   - on the first batch (initial activeDim=null + first question lands)
  //   - after the user closes the current card (activeDim flips to null
  //     while questions remain — drives the "transition to second
  //     question" behaviour with rule-25 batched questions)
  //   - if the active card is closed without an answer (e.g. user
  //     clicks the petal again to toggle off)
  //
  // The `collectAnswer` action removes the answered question from
  // `pendingQuestions` synchronously (matrixBuildSlice line ~990), so
  // by the time activeDim flips to null the next iteration's first
  // question is the next unanswered one. No tracking of "already
  // answered locally" needed.
  useEffect(() => {
    const count = pendingQuestions?.length ?? 0;
    if (count === 0) return;
    if (activeDim !== null) return;
    const first = pendingQuestions?.[0];
    if (!first) return;
    const dim = CELL_KEY_TO_DIM[first.cellKey];
    if (dim) setActiveDim(dim);
  }, [pendingQuestions, activeDim, setActiveDim]);

  const activeQuestion = useMemo(() => {
    if (!activeDim || !pendingQuestions) return null;
    return pendingQuestions.find((q) => CELL_KEY_TO_DIM[q.cellKey] === activeDim) ?? null;
  }, [activeDim, pendingQuestions]);

  const activeDimSummary = useMemo(() => {
    if (!activeDim || !activeRow) return [] as string[];
    const lines: string[] = [];
    const r = activeRow;
    switch (activeDim) {
      case "trigger": lines.push(...r.triggers.map((t) => t.description || t.trigger_type)); break;
      case "connector": lines.push(...r.connectors.map((c) => c.label || c.name)); break;
      case "task": if (r.summary) lines.push(r.summary); else lines.push(r.title); break;
      case "event": lines.push(...r.events.map((e) => e.description || e.event_type)); break;
      case "message": if (r.messageSummary) lines.push(r.messageSummary); break;
      case "review": if (r.reviewSummary) lines.push(r.reviewSummary); break;
      case "memory": if (r.memorySummary) lines.push(r.memorySummary); break;
      case "error": if (r.errorSummary) lines.push(r.errorSummary); break;
    }
    return lines;
  }, [activeDim, activeRow]);

  return { petalStates, activeQuestion, activeDimSummary };
}
