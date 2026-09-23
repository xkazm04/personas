/** SheetFrame — one of the eight frames on the contact sheet. Unexposed it is
 *  crop marks, a number, a label and the faint negative of its sigil aura; as
 *  the build learns, it develops (inverted and blurred to clear) into a small
 *  picture of its value, tinted in its petal's colour. */
import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import type { FrameState } from "./sheetModel";
import { frameNumber } from "./sheetModel";
import type { FrameValue } from "./useFrameValues";
import { DimAuraMark, FramePicture } from "./FramePictures";
import { COPY } from "./copy";

interface SheetFrameProps {
  dim: GlyphDimension;
  label: string;
  state: FrameState;
  value: FrameValue | null;
  dimmed: boolean;
  compact: boolean;
  onOpen: (dim: GlyphDimension, el: HTMLElement) => void;
}

const ERR = "#f87171";

function cropMarks(c: string) {
  const g = `linear-gradient(${c},${c})`;
  return [
    `${g} top left/16px 1px no-repeat`, `${g} top left/1px 16px no-repeat`,
    `${g} top right/16px 1px no-repeat`, `${g} top right/1px 16px no-repeat`,
    `${g} bottom left/16px 1px no-repeat`, `${g} bottom left/1px 16px no-repeat`,
    `${g} bottom right/16px 1px no-repeat`, `${g} bottom right/1px 16px no-repeat`,
  ].join(",");
}

function captionFor(state: FrameState, value: FrameValue | null): string {
  if (state === "pending") return COPY.frame.needsYou;
  if (state === "filling") return value?.caption ?? COPY.frame.developing;
  if (state === "error") return COPY.frame.error;
  if (value) return value.caption;
  return state === "unset" ? COPY.frame.notSet : "";
}

export const SheetFrame = memo(function SheetFrame({ dim, label, state, value, dimmed, compact, onOpen }: SheetFrameProps) {
  const reduce = useReducedMotion();
  const color = DIM_META[dim].color;
  const mark = state === "error" ? ERR
    : state === "pending" ? color
    : state === "lit" ? colorWithAlpha(color, 0.6)
    : "color-mix(in srgb, var(--foreground) 16%, transparent)";
  const showPicture = !!value && (state === "lit" || state === "pending" || state === "filling" || state === "error");
  const caption = captionFor(state, value);

  return (
    <button
      type="button"
      onClick={(e) => onOpen(dim, e.currentTarget)}
      aria-label={`${frameNumber(dim)} ${label}: ${caption || COPY.frame.unexposed}`}
      className="relative w-full h-full min-w-0 min-h-0 flex flex-col text-left px-3.5 py-2.5 rounded-[4px] transition-[opacity,background-color] duration-500 hover:bg-foreground/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60"
      style={{
        background: `${cropMarks(mark)}, color-mix(in srgb, var(--background) 62%, transparent)`,
        opacity: dimmed ? 0.22 : 1,
        boxShadow: state === "pending" ? `0 0 28px ${colorWithAlpha(color, 0.22)}` : undefined,
      }}
    >
      <span className="flex items-center gap-2 typo-caption">
        <span className="font-mono text-foreground">{frameNumber(dim)}</span>
        <span className="font-semibold uppercase tracking-[0.12em]" style={{ color: state === "lit" || state === "pending" ? color : "var(--muted-foreground)" }}>
          {label}
        </span>
        <span
          className="ml-auto w-[7px] h-[7px] rounded-full"
          style={{
            background: state === "lit" ? color : state === "pending" ? color : state === "error" ? ERR : "color-mix(in srgb, var(--foreground) 16%, transparent)",
            boxShadow: state === "pending" ? `0 0 0 4px ${colorWithAlpha(color, 0.25)}` : undefined,
          }}
        />
      </span>

      <span className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {state === "filling" && (
          <motion.span
            aria-hidden
            className="absolute w-3/5 h-1/2 rounded-card"
            style={{ background: `radial-gradient(ellipse at center, ${colorWithAlpha(color, 0.26)}, transparent 70%)` }}
            animate={reduce ? { opacity: 0.6 } : { opacity: [0.35, 0.9, 0.35] }}
            transition={reduce ? undefined : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={showPicture ? `pic-${state === "lit" ? "lit" : "raw"}-${value?.by ?? ""}` : "neg"}
            className="relative flex items-center justify-center"
            initial={reduce ? { opacity: 0 } : { opacity: 0.15, filter: "invert(1) blur(5px) brightness(1.5)" }}
            animate={{ opacity: 1, filter: "invert(0) blur(0px) brightness(1)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 1.2, ease: "easeOut" }}
          >
            {showPicture && value ? <FramePicture dim={dim} value={value} compact={compact} /> : <DimAuraMark dim={dim} size={compact ? 34 : 46} lit={false} />}
          </motion.span>
        </AnimatePresence>
      </span>

      {!compact || caption ? (
        <span className={`typo-body truncate min-h-[20px] ${state === "error" ? "text-red-400" : "text-foreground"}`}>
          {caption}
        </span>
      ) : null}
    </button>
  );
});
