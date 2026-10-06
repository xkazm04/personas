/** useSheetDrawing - the annotated sheet's timed build-up.
 *
 *  Every part the sheet can draw is a STEP with a stable id: the top
 *  dimension line, each frame's inking (`ink:<dim>`, once it is populated),
 *  each margin note (`note:<dim>:<kind>`) and the bottom chain dimension
 *  (`caps`, `time`). Steps join the drawing in the order the build reveals
 *  them (first seen, never re-sorted), so a fact that lands late is drawn
 *  last instead of shifting what is already on paper; `useDraftSteps` then
 *  draws them one beat apart. The key is the build session plus the drawing
 *  kind, so a new session redraws the sheet from its first line. Nothing here
 *  gates a control: frames stay clickable whatever is drawn. */
import { useEffect, useMemo, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useDraftSteps } from "../blueprint";
import type { Note } from "./annotationModel";
import { COPY } from "./copy";

export interface Step { id: string; label: string }

interface Order { key: string; ids: string[] }

/** First-seen order: ids still present keep their place, new ones append. */
export function mergeOrder(prev: Order, key: string, ids: readonly string[]): Order {
  if (prev.key !== key) return { key, ids: [...ids] };
  const live = new Set(ids);
  const kept = prev.ids.filter((id) => live.has(id));
  const seen = new Set(kept);
  const added = ids.filter((id) => !seen.has(id));
  if (added.length === 0 && kept.length === prev.ids.length) return prev;
  return { key, ids: [...kept, ...added] };
}

function useAppendOrder(key: string, ids: readonly string[]): string[] {
  const [order, setOrder] = useState<Order>(() => ({ key, ids: [...ids] }));
  const next = mergeOrder(order, key, ids);
  // Adjust-on-render: converges in one pass because a merged order merges to itself.
  if (next !== order) setOrder(next);
  return next.ids;
}

/** True for `ms` after `signal` changes: the pen keeps writing its last
 *  callout for a moment after the final step lands. */
function useRecent(signal: number, ms: number): boolean {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (signal === 0) return;
    setAt(signal);
    const h = window.setTimeout(() => setAt(null), ms);
    return () => window.clearTimeout(h);
  }, [signal, ms]);
  return at !== null;
}

interface Args {
  key: string;
  annotate: boolean;
  premiere: boolean;
  populated: Record<GlyphDimension, boolean>;
  notes: Record<GlyphDimension, Note[]>;
  labels: Record<GlyphDimension, string>;
  caps: number;
  /** The settled build time, once there is one to dimension. */
  buildTime: string | null;
}

export function useSheetDrawing({ key, annotate, premiere, populated, notes, labels, caps, buildTime }: Args) {
  const steps = useMemo(() => {
    // The top dimension line exists only where there is a band to draw it in.
    const out: Step[] = annotate ? [{ id: "dims", label: COPY.sheet.dims(GLYPH_DIMENSIONS.length) }] : [];
    for (const dim of GLYPH_DIMENSIONS) {
      if (!populated[dim]) continue;
      out.push({ id: `ink:${dim}`, label: labels[dim] });
      if (annotate && !premiere) for (const n of notes[dim]) out.push({ id: n.id, label: `${n.kind}: ${n.text}` });
    }
    if (annotate && !premiere && caps > 0) out.push({ id: "caps", label: COPY.sheet.caps(caps) });
    if (annotate && !premiere && buildTime) out.push({ id: "time", label: COPY.sheet.buildTime(buildTime) });
    return out;
  }, [annotate, premiere, populated, notes, labels, caps, buildTime]);

  const byId = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const order = useAppendOrder(key, useMemo(() => steps.map((s) => s.id), [steps]));
  const count = useDraftSteps(key, order.length);
  const drawn = useMemo(() => new Set(order.slice(0, count)), [order, count]);
  const latestId = count > 0 ? order[count - 1] : undefined;
  const latest = latestId ? byId.get(latestId) ?? null : null;
  const recent = useRecent(count, 2600);

  return {
    /** Ids drawn so far. */
    drawn,
    count,
    /** The part drawn last, where the pen sits during the build-up. */
    latest,
    /** Still drawing (or just finished the last stroke). */
    drawing: count < order.length || recent,
  };
}

export type SheetDrawing = ReturnType<typeof useSheetDrawing>;
