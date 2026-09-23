/** PushLayer — the camera push into a frame's inner layer, and the pull back.
 *
 *  The layer is born at the exact rectangle of the frame (or control) that
 *  opened it and grows to fill the sheet; on exit it shrinks back into that
 *  same rectangle, so the answer visibly lands in the frame it belongs to.
 *  Everything heavy (questions, pickers, test reports, persona core) lives one
 *  layer down like this, never on the sheet itself. */
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { COPY } from "./copy";

export interface Rect { x: number; y: number; w: number; h: number }

interface PushLayerProps {
  from: Rect;
  stage: { w: number; h: number };
  color: string;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function layerBox(stage: { w: number; h: number }): Rect {
  const w = Math.max(280, Math.min(640, stage.w - 48));
  return { x: (stage.w - w) / 2, y: 8, w, h: Math.max(200, stage.h - 16) };
}

export function PushLayer({ from, stage, color, label, onClose, children }: PushLayerProps) {
  const reduce = useReducedMotion();
  const box = layerBox(stage);
  const collapsed = {
    x: from.x - box.x,
    y: from.y - box.y,
    scaleX: from.w / box.w,
    scaleY: from.h / box.h,
    opacity: 0.15,
  };
  return (
    <motion.div
      role="region"
      aria-label={label}
      className="absolute z-30 flex flex-col rounded-modal bg-background overflow-hidden"
      style={{
        left: box.x, top: box.y, width: box.w, height: box.h,
        transformOrigin: "0 0",
        boxShadow: `0 0 0 1px ${colorWithAlpha(color, 0.7)}, 0 0 40px ${colorWithAlpha(color, 0.22)}, 0 24px 60px rgba(0,0,0,0.55)`,
      }}
      initial={reduce ? { opacity: 0 } : collapsed}
      animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { ...collapsed, opacity: 0 }}
      transition={{ duration: 0.46, ease: [0.2, 0.7, 0.2, 1] }}
    >
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <button
        type="button"
        onClick={onClose}
        aria-label={COPY.back}
        className="absolute top-3 right-3 z-10 w-8 h-8 grid place-items-center rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 flex flex-col">{children}</div>
    </motion.div>
  );
}
