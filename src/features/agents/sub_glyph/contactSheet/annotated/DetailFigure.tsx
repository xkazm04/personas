/** DetailFigure - the frame redrawn at 2:1 on the detail sheet: a scale bar
 *  over it, the frame as a large drafted region in the same ink states as on
 *  the sheet (dashed, hatched, inked by the same diagonal wipe, ticked), its
 *  picture printed large, its caption on a rule in the frame's colour, and
 *  the frame's margin notes re-lettered at reading size beneath it, each one
 *  drawn as its own step. */
import { forwardRef } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";
import { frameNumber } from "../cinema/sheetModel";
import type { FrameValue } from "../cinema/useFrameValues";
import { DimAuraMark, FramePicture } from "../cinema/FramePictures";
import type { Ink, Note } from "./annotationModel";
import { WIPE } from "./DraftedFrame";
import { InkTick, dimInk } from "./ink";
import { COPY } from "./copy";

interface DetailFigureProps {
  dim: GlyphDimension;
  ink: Ink;
  picture: FrameValue | null;
  caption: string;
  notes: Note[];
  drawn: ReadonlySet<string>;
}

function ScaleBar() {
  const { shouldAnimate } = useMotion();
  return (
    <div aria-hidden className="relative h-4">
      <i className="absolute left-0 top-0.5 block h-3 w-px" style={{ background: "var(--ink-dim)" }} />
      <i className="absolute right-0 top-0.5 block h-3 w-px" style={{ background: "var(--ink-dim)" }} />
      <motion.i
        className="absolute inset-x-0 top-2 block h-px origin-left"
        style={{ background: "var(--ink-dim)" }}
        initial={shouldAnimate ? { scaleX: 0 } : false}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      <span className="absolute left-1/2 top-2 -translate-x-1/2 -translate-y-1/2 px-1.5" style={{ ...LETTERING, fontSize: 11, color: "var(--ink)", background: "var(--background)" }}>
        {COPY.detail.scale}
      </span>
    </div>
  );
}

export const DetailFigure = forwardRef<HTMLDivElement, DetailFigureProps>(function DetailFigure({ dim, ink, picture, caption, notes, drawn }, ref) {
  const { shouldAnimate } = useMotion();
  const color = DIM_META[dim].color;
  const inked = ink === "inked";
  const hatched = ink === "drafting" || ink === "needs";
  const num = frameNumber(dim);

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3" data-testid="annotated-detail-figure" data-ink={ink}>
      <ScaleBar />
      <div ref={ref} className="relative rounded-interactive" style={{ aspectRatio: "4 / 3", border: `1px dashed ${ink === "error" ? "var(--status-error)" : "var(--ink-dim)"}`, background: "color-mix(in srgb, var(--background) 70%, transparent)" }}>
        {hatched && <div aria-hidden className="drafting-hatch absolute inset-0 rounded-interactive" style={ink === "needs" ? { ["--ink-dim" as string]: colorWithAlpha(color, 0.5) } : undefined} />}
        {inked && (
          <motion.div
            aria-hidden
            {...(shouldAnimate ? WIPE : {})}
            className="absolute inset-0 rounded-interactive"
            style={{ border: `1.5px solid ${dimInk(color)}`, background: `radial-gradient(ellipse at 50% 42%, ${colorWithAlpha(color, 0.12)}, transparent 72%)` }}
          />
        )}
        <span
          aria-hidden
          className="absolute -left-3 -top-3 inline-flex h-7 w-7 items-center justify-center rounded-full"
          style={{ ...LETTERING, letterSpacing: 0, background: inked ? dimInk(color) : "var(--background)", border: inked ? "none" : "1px dashed var(--ink-dim)", color: inked ? "var(--background)" : "var(--ink)" }}
        >
          {num}
        </span>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="origin-center scale-125 2xl:scale-150">
            {picture && (inked || hatched) ? <FramePicture dim={dim} value={picture} compact={false} /> : <DimAuraMark dim={dim} size={56} lit={false} />}
          </span>
        </span>
        {inked && <InkTick color={dimInk(color)} delay={shouldAnimate ? 0.7 : 0} />}
      </div>
      <figcaption className="truncate pl-2 typo-body text-foreground" style={{ borderLeft: `3px solid ${inked ? color : "var(--ink-dim)"}` }}>
        {caption}
      </figcaption>

      <div className="mt-2 flex flex-col gap-2">
        <span style={{ ...LETTERING, color: "var(--ink)" }}>{COPY.detail.notes}</span>
        {notes.length === 0 && <p className="typo-body text-foreground">{COPY.detail.noNotes}</p>}
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {notes.map((n, i) => drawn.has(n.id) ? (
            <motion.li
              key={n.id}
              className="flex items-baseline gap-3 border-l pl-3"
              style={{ borderColor: dimInk(color) }}
              initial={shouldAnimate ? { opacity: 0, x: -8 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45 }}
              data-testid="annotated-detail-note"
            >
              <span className="shrink-0" style={{ ...LETTERING, color: dimInk(color) }}>{`${num}.${i + 1} ${n.kind}`}</span>
              <span className="min-w-0 typo-body-lg text-foreground">{n.text}</span>
            </motion.li>
          ) : <li key={n.id} aria-hidden className="invisible h-7" />)}
        </ol>
      </div>
    </figure>
  );
});
