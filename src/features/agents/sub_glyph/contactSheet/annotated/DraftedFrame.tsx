/** DraftedFrame - one of the eight frames, drawn as a region on a drawing.
 *
 *  Empty, it is a dashed ghost with its numbered caption badge and its label
 *  lettered in. When data starts arriving it is hatched under the pen (in the
 *  frame's own colour while a question is open on it). When the pen reaches
 *  it in the build-up, it is inked: a diagonal wipe lays a solid outline in
 *  the frame's colour mixed into the ink, the badge fills, a tick lands, and
 *  the frame's picture prints. The whole cell is one control (a ghost Button
 *  under the drawing), live whatever the drawing shows. */
import { memo } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import Button from "@/features/shared/components/buttons/Button";
import { LETTERING } from "../blueprint";
import { frameNumber } from "../cinema/sheetModel";
import type { FrameValue } from "../cinema/useFrameValues";
import { DimAuraMark, FramePicture } from "../cinema/FramePictures";
import type { Ink } from "./annotationModel";
import { InkTick, dimInk } from "./ink";
import { COPY } from "./copy";

interface DraftedFrameProps {
  dim: GlyphDimension;
  label: string;
  ink: Ink;
  value: FrameValue | null;
  compact: boolean;
  onOpen: (dim: GlyphDimension) => void;
}

const PAPER = "color-mix(in srgb, var(--background) 66%, transparent)";
/** The diagonal wipe: a triangle growing out of the top-left corner. */
export const WIPE = {
  initial: { clipPath: "polygon(0% 0%, 0% 0%, 0% 0%)" },
  animate: { clipPath: "polygon(0% 0%, 220% 0%, 0% 220%)" },
  transition: { duration: 0.9, ease: "easeOut" as const },
};

function captionOf(ink: Ink, value: FrameValue | null): string {
  if (ink === "needs") return COPY.ink.needsYou;
  if (ink === "error") return COPY.ink.error;
  if (ink === "unused") return COPY.ink.unused;
  if (ink === "drafting") return value?.caption ?? COPY.ink.drafting;
  return ink === "inked" ? value?.caption ?? "" : "";
}

export const DraftedFrame = memo(function DraftedFrame({ dim, label, ink, value, compact, onOpen }: DraftedFrameProps) {
  const { shouldAnimate } = useMotion();
  const color = DIM_META[dim].color;
  const inked = ink === "inked";
  const hatched = ink === "drafting" || ink === "needs";
  const caption = captionOf(ink, value);
  const num = frameNumber(dim);
  const ghost = ink === "unused" ? "var(--ink-faint)" : ink === "error" ? "var(--status-error)" : "var(--ink-dim)";

  return (
    <div className="relative h-full w-full min-h-0 min-w-0" data-testid={`annotated-frame-${dim}`} data-ink={ink}>
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-interactive" style={{ background: PAPER, border: `1px dashed ${ghost}` }} />
      {/* The hit area sits on the paper and under the drawing, so its hover
          fill tints the region while every line stays on top. */}
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${num} ${label}${caption ? `: ${caption}` : ""}`}
        onClick={() => onOpen(dim)}
        className="absolute inset-0 h-full w-full rounded-interactive"
      />
      {hatched && (
        <div
          aria-hidden
          className="drafting-hatch pointer-events-none absolute inset-0 rounded-interactive"
          style={ink === "needs" ? { ["--ink-dim" as string]: colorWithAlpha(color, 0.5), boxShadow: `0 0 26px ${colorWithAlpha(color, 0.22)}` } : undefined}
        />
      )}
      {inked && (
        <motion.div
          aria-hidden
          {...(shouldAnimate ? WIPE : {})}
          className="pointer-events-none absolute inset-0 rounded-interactive"
          style={{ border: `1px solid ${dimInk(color)}`, background: `linear-gradient(${colorWithAlpha(color, 0.07)}, ${colorWithAlpha(color, 0.02)})` }}
        />
      )}

      <div aria-hidden className="pointer-events-none relative flex h-full min-h-0 flex-col px-3 py-2">
        <span className="flex items-center gap-2">
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
            style={{
              ...LETTERING, fontSize: 10, letterSpacing: 0,
              background: inked ? dimInk(color) : "transparent",
              border: inked ? "none" : `1px dashed ${ghost}`,
              color: inked ? "var(--background)" : "var(--ink)",
              transition: "background 0.5s ease",
            }}
          >
            {num}
          </span>
          <span className="min-w-0 truncate" style={{ ...LETTERING, color: inked ? color : hatched ? "var(--ink-strong)" : "var(--ink)" }}>{label}</span>
          {hatched && <span className="ml-auto shrink-0" style={{ ...LETTERING, fontSize: 10, color: ink === "needs" ? color : "var(--ink)" }}>{ink === "needs" ? COPY.ink.needsYou : COPY.ink.drafting}</span>}
        </span>

        <span className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {value && (inked || hatched) ? (
            <motion.span
              key={inked ? "inked" : "draft"}
              className="relative flex items-center justify-center"
              initial={shouldAnimate ? { opacity: 0 } : false}
              animate={{ opacity: inked ? 1 : 0.55 }}
              transition={{ duration: 0.6, delay: inked && shouldAnimate ? 0.5 : 0 }}
            >
              <FramePicture dim={dim} value={value} compact={compact} />
            </motion.span>
          ) : (
            <DimAuraMark dim={dim} size={compact ? 30 : 42} lit={false} />
          )}
        </span>

        {(!compact || caption) && (
          <span className={`block min-h-[20px] truncate typo-body ${ink === "error" ? "text-status-error" : "text-foreground"}`}>{caption}</span>
        )}
      </div>
      {inked && <InkTick color={dimInk(color)} delay={shouldAnimate ? 0.7 : 0} />}
    </div>
  );
});
