/** PersonaDrawing - the left of sheet 1: the persona as a drafted object.
 *  Four regions along the top, four along the bottom (clockwise, each on the
 *  side its petal points to), the sigil in line work between them, and a
 *  dimension line under the whole drawing. Every region is a door into its
 *  own sheet. */
import { useRef } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import type { CentreActions } from "../cinema/centre/ActPanel";
import { COPY as CINEMA } from "../cinema/copy";
import { BOTTOM_ROW, TOP_ROW, dimNumber, drawingGeometry, type Ink } from "./sheetGeometry";
import type { DraftingSequence } from "./useDraftingSequence";
import { useBoxSize } from "./useBoxSize";
import { DraftPart } from "./DraftPart";
import { SigilFigure } from "./SigilFigure";
import { FigureCentre } from "./FigureCentre";
import { DimensionLine } from "./sheetParts";
import { COPY } from "./copy";

interface PersonaDrawingProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  seq: DraftingSequence;
  inks: Record<GlyphDimension, Ink>;
  labels: Record<GlyphDimension, string>;
  refFor: (id: string) => (el: HTMLElement | null) => void;
  onOpen: (dim: GlyphDimension) => void;
}

/** The value line a region carries: only what it has earned. */
function captionOf(ink: Ink, value: { caption: string } | null): string | null {
  if (ink === "asking") return CINEMA.frame.needsYou;
  if (ink === "error") return null;
  if (ink === "drafting") return value?.caption ?? CINEMA.frame.developing;
  return ink === "done" ? value?.caption ?? null : null;
}

export function PersonaDrawing({ p, s, a, seq, inks, labels, refFor, onOpen }: PersonaDrawingProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { w, h } = useBoxSize(boxRef);
  const geo = drawingGeometry(w, h, TOP_ROW.length, BOTTOM_ROW.length, s.isCompose ? 0 : 64);
  const rows = p.glyphRows.length;

  const region = (dim: GlyphDimension, box: (typeof geo.top)[number] | undefined) => {
    if (!box || !seq.drawn.has(dim)) return null;
    const n = String(dimNumber(dim));
    return (
      <DraftPart
        key={dim}
        box={box}
        n={n}
        label={labels[dim]}
        ink={inks[dim]}
        color={DIM_META[dim].color}
        caption={captionOf(inks[dim], s.frameValues[dim])}
        partRef={refFor(`region:${dim}`)}
        onOpen={() => onOpen(dim)}
        openLabel={COPY.nested.open(String(dimNumber(dim) + 1), labels[dim])}
        testId={`drafting-region-${dim}`}
      />
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <div ref={boxRef} className="relative min-h-0 flex-1" data-testid="drafting-persona-drawing">
        <div ref={refFor("figure")} className="absolute" style={{ left: geo.figure.cx - geo.figure.size / 2, top: geo.figure.cy - geo.figure.size / 2, width: geo.figure.size, height: geo.figure.size }} />
        <SigilFigure geo={geo} w={w} h={h} drawn={seq.drawn} inks={inks} presence={s.presence} quiet={s.isCompose} />
        {TOP_ROW.map((dim, i) => region(dim, geo.top[i]))}
        {BOTTOM_ROW.map((dim, i) => region(dim, geo.bottom[i]))}
        <FigureCentre p={p} s={s} a={a} geo={geo} />
      </div>
      <DimensionLine label={rows > 0 ? COPY.dimLine.capabilities(rows) : COPY.dimLine.dimensions} />
    </div>
  );
}
