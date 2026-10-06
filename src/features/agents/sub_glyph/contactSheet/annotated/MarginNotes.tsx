/** MarginNotes - what the sheet has learned, written in its margins.
 *
 *  Each frame with confirmed facts gets a block of notes in the nearer side
 *  margin, tied to the frame by a leader line (drawn on with the block's
 *  first note, a dot where it touches the frame). The middle-column frames
 *  run their leader along the band above or below the sheet. Notes are drawn
 *  one step at a time; an undrawn note keeps its slot, so the margin never
 *  reflows. Dimension lines run along the top edge (the eight dimensions and
 *  how many are inked) and the bottom edge (a chain: capabilities, build time). */
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";
import { frameNumber } from "../cinema/sheetModel";
import type { Note, PlacedBlock } from "./annotationModel";
import { NOTE_H } from "./annotationModel";
import type { SheetGeometry } from "./sheetGeometry";
import { DimensionLine } from "./DimensionLine";
import { dimInk } from "./ink";
import { COPY } from "./copy";

interface MarginNotesProps {
  geo: SheetGeometry;
  blocks: PlacedBlock[];
  notes: Record<GlyphDimension, Note[]>;
  drawn: ReadonlySet<string>;
  caps: number;
  buildTime: string | null;
  register: (id: string, el: HTMLElement | null) => void;
}

function Leader({ b, color }: { b: PlacedBlock; color: string }) {
  const { shouldAnimate } = useMotion();
  return (
    <g>
      <motion.path
        d={b.leader} fill="none" stroke={color} strokeWidth={1}
        initial={shouldAnimate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
      />
      <motion.circle
        cx={b.dot.x} cy={b.dot.y} r={2.6} fill={color}
        initial={shouldAnimate ? { scale: 0 } : false}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3 }}
      />
    </g>
  );
}

function Block({ b, notes, drawn, register }: { b: PlacedBlock; notes: Note[]; drawn: ReadonlySet<string>; register: MarginNotesProps["register"] }) {
  const color = dimInk(DIM_META[b.dim].color);
  const right = b.side === "left";
  return (
    <div className="pointer-events-none absolute flex flex-col" style={{ left: b.x, top: b.y, width: b.w }} data-testid={`annotated-notes-${b.dim}`}>
      {notes.map((n, i) => drawn.has(n.id) ? (
        <motion.div
          key={n.id}
          ref={(el) => register(n.id, el)}
          className={`flex min-w-0 flex-col ${right ? "items-end text-right" : ""}`}
          style={{ height: NOTE_H }}
          initial={{ opacity: 0, x: right ? 8 : -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <span className="max-w-full truncate" style={{ ...LETTERING, fontSize: 10.5, color }}>
            {`${frameNumber(b.dim)}.${i + 1} ${n.kind}`}
          </span>
          <span className="block max-w-full truncate typo-caption text-foreground">{n.text}</span>
        </motion.div>
      ) : <div key={n.id} aria-hidden style={{ height: NOTE_H }} />)}
    </div>
  );
}

export function MarginNotes({ geo, blocks, notes, drawn, caps, buildTime, register }: MarginNotesProps) {
  const s = geo.sheet;
  const inked = GLYPH_DIMENSIONS.filter((d) => drawn.has(`ink:${d}`)).length;
  const [c1, c2, c3] = geo.cols;
  const chainY = s.y + s.h + 26;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-testid="annotated-margins">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {blocks.filter((b) => drawn.has(notes[b.dim][0]?.id ?? "")).map((b) => (
          <Leader key={b.dim} b={b} color={dimInk(DIM_META[b.dim].color)} />
        ))}
      </svg>
      {blocks.map((b) => <Block key={b.dim} b={b} notes={notes[b.dim]} drawn={drawn} register={register} />)}
      {drawn.has("dims") && (
        <DimensionLine
          x={s.x} y={12} w={s.w} toward="down" testId="annotated-dim-top" elRef={(el) => register("dims", el)}
          label={`${COPY.sheet.dims(GLYPH_DIMENSIONS.length)}${inked ? `  ·  ${COPY.sheet.inked(inked)}` : ""}`}
        />
      )}
      {c1 && c2 && c3 && drawn.has("caps") && caps > 0 && (
        <DimensionLine x={c1.x} y={chainY} w={c2.x + c2.w - c1.x} toward="up" label={COPY.sheet.caps(caps)} elRef={(el) => register("caps", el)} />
      )}
      {c3 && drawn.has("time") && buildTime && (
        <DimensionLine x={c3.x} y={chainY} w={c3.w} toward="up" label={COPY.sheet.buildTime(buildTime)} elRef={(el) => register("time", el)} />
      )}
    </div>
  );
}
