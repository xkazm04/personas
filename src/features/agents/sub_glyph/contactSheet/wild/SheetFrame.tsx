/** SheetFrame: one of the eight frames around the brief.
 *
 *  States map to darkroom chemistry: unexposed (a dashed negative), latent (a
 *  safelight glow fades up once, while the engine is filling the cell), needs
 *  you (safelight red crop marks), developed (the print comes up from an
 *  inverted, blurred negative with a one-pass developer wash), not used, and
 *  fogged. Every animation fires on a state change and settles; nothing loops. */
import { motion, useReducedMotion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { FramePicture } from "./FramePicture";
import type { FrameModel } from "./frameModel";
import { COPY } from "./wildCopy";

/** Clockwise around the centre, starting top-left. */
export const FRAME_AREA: Record<GlyphDimension, string> = {
  trigger: "1 / 1", task: "1 / 2", connector: "1 / 3", message: "2 / 3",
  review: "3 / 3", memory: "3 / 2", event: "3 / 1", error: "2 / 1",
};
/** Camera target (transform-origin %) for each frame on the 1fr 1.5fr 1fr x 1fr 2fr 1fr sheet. */
export const FRAME_ORIGIN: Record<GlyphDimension, string> = {
  trigger: "14% 12%", task: "50% 12%", connector: "86% 12%", message: "86% 50%",
  review: "86% 88%", memory: "50% 88%", event: "14% 88%", error: "14% 50%",
};

interface SheetFrameProps {
  index: number;
  label: string;
  model: FrameModel;
  premiere: boolean;
  dimmed: boolean;
  onOpen: () => void;
}

const DEVELOP = {
  initial: { filter: "invert(1) blur(6px) sepia(.6) brightness(1.4)", opacity: 0.12, scale: 1.04 },
  animate: { filter: "invert(0) blur(0px) sepia(0) brightness(1)", opacity: 1, scale: 1 },
};

export function SheetFrame({ index, label, model, premiere, dimmed, onOpen }: SheetFrameProps) {
  const reduce = useReducedMotion();
  const n = String(index + 1).padStart(2, "0");
  const area = premiere ? `2 / ${index + 1}` : FRAME_AREA[model.dim];
  const byLine = model.by === "you" ? COPY.frame.you : model.by === "ai" ? COPY.frame.ai : "";
  return (
    <motion.button
      type="button"
      layout
      layoutDependency={premiere}
      transition={{ layout: { duration: 0.9, ease: [0.3, 0.7, 0.2, 1], delay: premiere ? index * 0.04 : 0 } }}
      className="csw-cell"
      data-state={model.state}
      data-dim={dimmed ? "true" : "false"}
      style={{ gridArea: area, padding: premiere ? "8px 10px" : undefined }}
      onClick={onOpen}
      aria-label={`${label}: ${model.caption}${byLine ? `. ${byLine}` : ""}. Alt+${index + 1}`}
    >
      <span className="csw-lab">
        <span className="csw-edge" style={{ color: "var(--cs-faint)" }}>{n}</span>
        <b>{label}</b>
        <span className="csw-dot" aria-hidden />
      </span>
      <span className="csw-img">
        {model.state === "blank" || model.state === "unused" ? <span className="csw-neg" aria-hidden /> : null}
        {model.state === "latent" && (
          <motion.span
            className="csw-latent"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 2.4, ease: "easeOut" }}
          />
        )}
        {model.picture && (model.state === "developed" || model.state === "fogged") && (
          <motion.span
            key={`${model.state}-${JSON.stringify(model.picture)}`}
            className="relative flex items-center justify-center"
            initial={reduce ? false : DEVELOP.initial}
            animate={DEVELOP.animate}
            transition={{ duration: 1.6, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <FramePicture picture={model.picture} compact={premiere} />
          </motion.span>
        )}
        {model.state === "developed" && !reduce && (
          <motion.span
            key={`wash-${JSON.stringify(model.picture)}`}
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{ background: "linear-gradient(100deg,transparent 30%,rgba(255,214,160,.22) 50%,transparent 70%)" }}
            initial={{ x: "-110%", opacity: 1 }}
            animate={{ x: "110%", opacity: 0 }}
            transition={{ duration: 1.4, ease: "easeInOut" }}
          />
        )}
      </span>
      {!premiere && <span className="csw-cap">{model.caption}</span>}
    </motion.button>
  );
}
