/** SheetFrame - one of the eight dimension frames on the contact sheet.
 *
 *  Crop marks, a number, the dimension label and a status dot. The frame is
 *  "unexposed" until the build (or the user) gives it a value, then the
 *  picture develops from a blurred negative. The invisible layout ghost is
 *  what the push-in panel grows out of and shrinks back into (shared
 *  `layoutId`), so the camera move always starts and ends on this cell. */
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { FramePicture } from "./FramePicture";
import { COPY } from "./copy";
import type { Frame, FrameState } from "./sheetModel";

export const frameLayoutId = (dim: GlyphDimension) => `cs-personas-frame-${dim}`;

const MARK: Record<FrameState, string> = {
  blank: "border-foreground/15",
  unset: "border-foreground/10",
  filling: "border-primary/40",
  pending: "border-status-warning",
  lit: "border-foreground/50",
  error: "border-status-error",
};
const DOT: Record<FrameState, string> = {
  blank: "bg-foreground/15",
  unset: "bg-foreground/10",
  filling: "bg-primary/50",
  pending: "bg-status-warning ring-4 ring-status-warning/20",
  lit: "bg-primary",
  error: "bg-status-error",
};
const CORNERS = [
  "top-0 left-0 border-t border-l",
  "top-0 right-0 border-t border-r",
  "bottom-0 left-0 border-b border-l",
  "bottom-0 right-0 border-b border-r",
];

const DEVELOP = {
  initial: { opacity: 0.15, filter: "invert(1) blur(5px) brightness(1.5)" },
  animate: { opacity: 1, filter: "invert(0) blur(0px) brightness(1)" },
  transition: { duration: 1.3, ease: [0.22, 1, 0.36, 1] as const },
};

interface SheetFrameProps {
  frame: Frame;
  index: number;
  /** CSS grid-area; changes when the sheet reflows into the premiere strip. */
  area: string;
  label: string;
  hint: string;
  dimmed: boolean;
  pushed: boolean;
  returning: boolean;
  compact?: boolean;
  onOpen: (dim: GlyphDimension) => void;
}

function caption(f: Frame): string {
  if (f.state === "pending") return COPY.capNeedsYou;
  if (f.state === "filling") return COPY.capDeveloping;
  if (f.state === "unset") return COPY.capNotSet;
  if (f.state === "error") return COPY.capError;
  return f.value?.words ?? "";
}

export function SheetFrame({ frame, index, area, label, hint, dimmed, pushed, returning, compact, onOpen }: SheetFrameProps) {
  const Icon = DIM_META[frame.dim].icon;
  const lit = frame.state === "lit" && frame.value;
  const sig = lit ? JSON.stringify(frame.value) : frame.state;
  const tone = frame.state === "pending" ? "text-status-warning" : frame.state === "error" ? "text-status-error" : lit ? "text-foreground" : "text-muted";
  return (
    <motion.button
      type="button"
      onClick={() => onOpen(frame.dim)}
      aria-label={`${label}: ${hint}. ${caption(frame)}`}
      layout="position"
      animate={{ opacity: dimmed ? 0.28 : 1 }}
      transition={{ duration: 0.3, layout: { duration: 0.9, delay: index * 0.04, ease: [0.3, 0.7, 0.2, 1] } }}
      style={{ gridArea: area }}
      className={`group relative min-w-0 min-h-0 flex flex-col text-left rounded-interactive focus-ring transition-colors hover:bg-secondary/40 ${compact ? "px-2.5 py-2" : "px-3.5 py-3"}`}
      data-testid={`cs-personas-frame-${frame.dim}`}
    >
      {CORNERS.map((c) => (
        <span key={c} aria-hidden className={`pointer-events-none absolute w-4 h-4 transition-colors duration-500 ${c} ${MARK[frame.state]}`} />
      ))}
      {!pushed && (
        <motion.span
          aria-hidden
          layoutId={frameLayoutId(frame.dim)}
          initial={{ opacity: returning ? 1 : 0 }}
          animate={{ opacity: 0 }}
          transition={{ layout: { duration: 0.42, ease: [0.5, 0, 0.2, 1] }, opacity: { delay: 0.34, duration: 0.25 } }}
          className="pointer-events-none absolute inset-0 rounded-card border border-primary/40 bg-background shadow-elevation-3"
        />
      )}
      <span className="relative flex items-center gap-2">
        <span className="typo-code text-muted">{String(index + 1).padStart(2, "0")}</span>
        <Icon className="w-3.5 h-3.5 flex-none" style={{ color: DIM_META[frame.dim].color }} />
        <span className={`typo-label truncate ${tone}`}>{label}</span>
        <span aria-hidden className={`ml-auto w-2 h-2 rounded-full flex-none transition-colors ${DOT[frame.state]}`} />
      </span>
      <span className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {lit ? (
          <motion.span key={sig} className={`flex items-center justify-center ${compact ? "scale-[0.7]" : ""}`} {...DEVELOP}>
            <FramePicture dim={frame.dim} value={frame.value!} />
          </motion.span>
        ) : frame.state === "filling" || frame.state === "pending" ? (
          <span
            aria-hidden
            className="w-3/5 h-1/2 rounded-card"
            style={{
              background: `radial-gradient(ellipse at center, color-mix(in srgb, var(--${frame.state === "pending" ? "status-warning" : "primary"}) 22%, transparent), transparent 70%)`,
            }}
          />
        ) : (
          <span aria-hidden className="w-2/5 h-px bg-foreground/10" />
        )}
      </span>
      <span className={`relative ${compact ? "typo-caption" : "typo-body"} truncate ${lit ? "text-foreground" : frame.state === "error" ? "text-status-error" : "text-muted"}`}>
        {caption(frame) || " "}
      </span>
    </motion.button>
  );
}
