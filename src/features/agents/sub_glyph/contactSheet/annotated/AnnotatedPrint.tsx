/** AnnotatedPrint - the drawing under the camera: the sigil, the 3x3 sheet of
 *  drafted frames inside its margins, and the margin notes around it.
 *
 *  Same sleep contract as Cinema's SheetPrint: memoised with a comparator
 *  that answers "unchanged" while the sheet is asleep (`frozen`), so an open
 *  layer never re-renders the drawing under it, and the grid boxes animate
 *  only when the grid changes shape (the premiere strip). */
import { memo } from "react";
import { LayoutGroup, motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { PetalState } from "@/features/shared/glyph/persona-sigil";
import type { FrameValue } from "../cinema/useFrameValues";
import { FRAME_CELL } from "../cinema/sheetModel";
import { SheetSigil } from "../cinema/SheetSigil";
import { EASE } from "../cinema/cinemaMotion";
import type { Ink } from "./annotationModel";
import { GAP, GRID_COLS, GRID_ROWS, type SheetGeometry } from "./sheetGeometry";
import { DraftedFrame } from "./DraftedFrame";
import { InkStamp } from "./ink";
import { REGISTRATION } from "./AnnotatedCentre";

const STRIP_H = 92;

interface AnnotatedPrintProps {
  frozen: boolean;
  premiere: boolean;
  geo: SheetGeometry;
  labels: Record<GlyphDimension, string>;
  inks: Record<GlyphDimension, Ink>;
  values: Record<GlyphDimension, FrameValue | null>;
  petalStates: Record<GlyphDimension, PetalState>;
  populated: Record<GlyphDimension, boolean>;
  accent: string;
  presence: number;
  stamp: string | null;
  onOpenFrame: (dim: GlyphDimension) => void;
  frameRef: (dim: GlyphDimension, el: HTMLDivElement | null) => void;
  centreRef: React.Ref<HTMLDivElement>;
  centre: React.ReactNode;
  /** The margin notes and dimension lines (MarginNotes), drawn over everything. */
  margins: React.ReactNode;
}

function AnnotatedPrintImpl(p: AnnotatedPrintProps) {
  const { premiere, geo } = p;
  const s = geo.sheet;
  const sigilCy = premiere ? s.y + (s.h - STRIP_H - GAP) / 2 : geo.centre.y + geo.centre.h / 2;
  const sigilSize = premiere ? Math.min(s.h - STRIP_H - GAP, s.w * 0.5) : Math.min(s.h * 1.02, s.w * 0.66);

  return (
    <>
      <SheetSigil
        size={sigilSize} cx={s.x + s.w / 2} cy={sigilCy} petalStates={p.petalStates} populated={p.populated}
        accent={p.accent} presence={p.presence} onPetal={p.onOpenFrame}
      />
      <div
        className="absolute grid"
        style={{
          left: s.x, top: s.y, width: s.w, height: s.h, gap: GAP,
          gridTemplateColumns: premiere ? "repeat(8, minmax(0, 1fr))" : GRID_COLS,
          gridTemplateRows: premiere ? `minmax(0, 1fr) ${STRIP_H}px` : GRID_ROWS,
        }}
      >
        <LayoutGroup id="annotated-grid">
          {GLYPH_DIMENSIONS.map((dim, i) => (
            <motion.div
              key={dim}
              layout
              layoutDependency={premiere}
              transition={{ duration: 0.9, ease: EASE, delay: premiere ? i * 0.04 : 0 }}
              ref={(el) => p.frameRef(dim, el)}
              className="min-h-0 min-w-0"
              style={premiere ? { gridColumn: i + 1, gridRow: 2 } : { gridColumn: FRAME_CELL[dim][0], gridRow: FRAME_CELL[dim][1] }}
            >
              <DraftedFrame dim={dim} label={p.labels[dim]} ink={p.inks[dim]} value={p.values[dim]} compact={premiere} onOpen={p.onOpenFrame} />
            </motion.div>
          ))}
          <motion.div
            ref={p.centreRef}
            layout
            layoutDependency={premiere}
            transition={{ duration: 0.9, ease: EASE }}
            className="relative flex min-h-0 min-w-0 items-center justify-center px-3 py-2"
            style={{ gridArea: premiere ? "1 / 1 / 2 / 9" : "2 / 2 / 3 / 3", background: premiere ? undefined : REGISTRATION }}
          >
            {p.centre}
            <InkStamp stamp={p.stamp} />
          </motion.div>
        </LayoutGroup>
      </div>
      {p.margins}
    </>
  );
}

/** Asleep: keep the last awake render, whatever the props say. */
export const AnnotatedPrint = memo(AnnotatedPrintImpl, (_prev, next) => next.frozen);
