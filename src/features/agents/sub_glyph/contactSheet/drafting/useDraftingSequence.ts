/** useDraftingSequence - the timed build-up of sheet 1, in Studio's step order:
 *  the eight regions first (each with its petal, its leader line and its goal
 *  row), then the brief, then each dimension inked as it becomes populated.
 *
 *  The steps after the regions are an APPEND-ONLY log of what has landed, in
 *  the order it landed: a dimension the composer filled before launch is inked
 *  before the brief, one the build decided later after it. A step that lands
 *  is drawn one beat after the previous one (useDraftSteps queues), so a burst
 *  of data still reads as being drawn. Nothing here gates a control. */
import { useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useDraftSteps } from "../blueprint";

export type DraftStep = { kind: "region"; dim: GlyphDimension } | { kind: "brief" } | { kind: "ink"; dim: GlyphDimension };

const REGIONS: DraftStep[] = GLYPH_DIMENSIONS.map((dim) => ({ kind: "region", dim }));

const sameStep = (a: DraftStep, b: DraftStep) => a.kind === b.kind && (a.kind === "brief" || a.dim === (b as { dim: GlyphDimension }).dim);

/** The log after the regions: what is still true, then what is new. */
function reconcile(tail: DraftStep[], populated: Record<GlyphDimension, boolean>, hasBrief: boolean): DraftStep[] {
  const kept = tail.filter((st) => (st.kind === "brief" ? hasBrief : st.kind === "ink" && populated[st.dim]));
  const next = [...kept];
  if (hasBrief && !next.some((st) => st.kind === "brief")) next.push({ kind: "brief" });
  for (const dim of GLYPH_DIMENSIONS) {
    if (populated[dim] && !next.some((st) => st.kind === "ink" && st.dim === dim)) next.push({ kind: "ink", dim });
  }
  return next;
}

export interface DraftingSequence {
  key: string;
  count: number;
  total: number;
  building: boolean;
  /** Regions whose outline has been drawn. */
  drawn: ReadonlySet<GlyphDimension>;
  /** Populated dimensions whose ink step has been drawn. */
  inked: ReadonlySet<GlyphDimension>;
  briefShown: boolean;
  /** The step drawn last, while the sheet is still building up. */
  last: DraftStep | null;
}

export function useDraftingSequence(key: string, populated: Record<GlyphDimension, boolean>, hasBrief: boolean): DraftingSequence {
  const [log, setLog] = useState<{ key: string; tail: DraftStep[] }>({ key, tail: [] });
  const current = log.key === key ? log.tail : [];
  const tail = reconcile(current, populated, hasBrief);
  // React's adjust-on-render pattern: the log follows the data in the same pass.
  if (log.key !== key || tail.length !== current.length || tail.some((st, i) => !sameStep(st, current[i]!))) {
    setLog({ key, tail });
  }

  const steps = [...REGIONS, ...tail];
  const count = useDraftSteps(key, steps.length);
  const done = steps.slice(0, count);
  const drawn = new Set<GlyphDimension>();
  const inked = new Set<GlyphDimension>();
  let briefShown = false;
  for (const st of done) {
    if (st.kind === "region") drawn.add(st.dim);
    else if (st.kind === "ink") inked.add(st.dim);
    else briefShown = true;
  }
  const building = count < steps.length;
  return { key, count, total: steps.length, building, drawn, inked, briefShown, last: building && count > 0 ? steps[count - 1]! : null };
}
