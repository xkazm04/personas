import { useEffect, useMemo, useRef } from "react";
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

  // Auto-focus the affected petal once per "round" of pending questions.
  // After the user submits an answer the popover closes (visual feedback
  // that the dimension is resolved); they then click another pulsing
  // petal to answer the next one. When all questions are cleared, the
  // ref resets so the next batch will auto-focus again.
  const autoSnappedRef = useRef(false);
  useEffect(() => {
    const count = pendingQuestions?.length ?? 0;
    if (count === 0) {
      autoSnappedRef.current = false;
      return;
    }
    if (autoSnappedRef.current) return;
    const first = pendingQuestions?.[0];
    if (!first) return;
    const dim = CELL_KEY_TO_DIM[first.cellKey];
    if (dim) {
      setActiveDim(dim);
      autoSnappedRef.current = true;
    }
  }, [pendingQuestions, setActiveDim]);

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
