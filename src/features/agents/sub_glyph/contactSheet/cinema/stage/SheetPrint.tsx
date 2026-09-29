/** SheetPrint - the print under the camera: the sigil and the 3x3 sheet.
 *
 *  It is memoised with a comparator that answers "unchanged" whenever the
 *  sheet is asleep (`frozen`), so while a layer is open React keeps the last
 *  awake render and never walks the sigil, the eight frames or the casting
 *  call. The layout boxes animate only when the grid itself changes shape
 *  (`layoutDependency={premiere}`); without it framer re-measured all nine
 *  boxes on every render, and the build clock renders twice a second. */
import { memo } from "react";
import { LayoutGroup, motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { PetalState } from "@/features/shared/glyph/persona-sigil";
import type { FrameState } from "../sheetModel";
import { FRAME_CELL } from "../sheetModel";
import type { FrameValue } from "../useFrameValues";
import { SheetFrame } from "../SheetFrame";
import { SheetSigil } from "../SheetSigil";
import { EASE } from "../cinemaMotion";

export const SHEET_GAP = 12;
export const STRIP_H = 92;

interface SheetPrintProps {
  frozen: boolean;
  premiere: boolean;
  stage: { w: number; h: number };
  labels: Record<GlyphDimension, string>;
  frameStates: Record<GlyphDimension, FrameState>;
  petalStates: Record<GlyphDimension, PetalState>;
  values: Record<GlyphDimension, FrameValue | null>;
  populated: Record<GlyphDimension, boolean>;
  accent: string;
  presence: number;
  onOpenFrame: (dim: GlyphDimension) => void;
  frameRef: (dim: GlyphDimension, el: HTMLDivElement | null) => void;
  centreRef: React.Ref<HTMLDivElement>;
  /** The centre cell's content, built by the layout. */
  centre: React.ReactNode;
}

function SheetPrintImpl(p: SheetPrintProps) {
  const { premiere, stage } = p;
  // Sigil geometry: centred on the centre cell, petals reaching into the frames.
  const sigilCy = premiere ? (stage.h - STRIP_H - SHEET_GAP) / 2 : stage.h / 2;
  const sigilSize = premiere ? Math.min(stage.h - STRIP_H - SHEET_GAP, stage.w * 0.5) : Math.min(stage.h * 0.98, stage.w * 0.62);

  return (
    <>
      <SheetSigil
        size={sigilSize} cx={stage.w / 2} cy={sigilCy} petalStates={p.petalStates} populated={p.populated}
        accent={p.accent} presence={p.presence} onPetal={p.onOpenFrame}
      />
      <div
        className="absolute inset-0 grid"
        style={{
          gap: SHEET_GAP,
          gridTemplateColumns: premiere ? "repeat(8, minmax(0, 1fr))" : "minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr)",
          gridTemplateRows: premiere ? `minmax(0, 1fr) ${STRIP_H}px` : "minmax(0, 1fr) minmax(0, 2.3fr) minmax(0, 1fr)",
        }}
      >
        <LayoutGroup id="sheet-cinema-grid">
          {GLYPH_DIMENSIONS.map((dim, i) => (
            <motion.div
              key={dim}
              layout
              layoutDependency={premiere}
              transition={{ duration: 0.9, ease: EASE, delay: premiere ? i * 0.04 : 0 }}
              ref={(el) => p.frameRef(dim, el)}
              className="min-w-0 min-h-0"
              style={premiere ? { gridColumn: i + 1, gridRow: 2 } : { gridColumn: FRAME_CELL[dim][0], gridRow: FRAME_CELL[dim][1] }}
            >
              <SheetFrame
                dim={dim} label={p.labels[dim]} state={p.frameStates[dim]} value={p.values[dim]}
                populated={p.populated[dim]} compact={premiere} onOpen={p.onOpenFrame}
              />
            </motion.div>
          ))}
          <motion.div
            ref={p.centreRef}
            layout
            layoutDependency={premiere}
            transition={{ duration: 0.9, ease: EASE }}
            className="min-w-0 min-h-0 flex items-center justify-center px-2"
            style={{ gridArea: premiere ? "1 / 1 / 2 / 9" : "2 / 2 / 3 / 3" }}
          >
            {p.centre}
          </motion.div>
        </LayoutGroup>
      </div>
    </>
  );
}

/** Asleep: keep the last awake render, whatever the props say. */
export const SheetPrint = memo(SheetPrintImpl, (_prev, next) => next.frozen);
