/** Loupe - the inner layer the camera pushes into.
 *
 *  It fills the whole stage (6 px inside it, so the pushed sheet still reads
 *  as the ground it came from) and grows out of the exact point on the sheet
 *  the camera is pushing about: the frame, the centre cell or the control
 *  that opened it. On the way out it shrinks back into that point. The paper
 *  is the app background with a hairline ring in the layer's colour and a deep
 *  drop, so it sits ON the sheet rather than replacing it. The header names
 *  where you are; the body scrolls only as a last resort. */
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { LAYER_HIDDEN, LAYER_MOVE, LAYER_SHOWN, type Shot } from "./useCamera";
import { LoupeHeader, type LoupeHead } from "./LoupeHeader";

/** Inset of the layer inside the stage, px. */
export const LOUPE_INSET = 6;

interface LoupeProps {
  shot: Shot;
  color: string;
  head: LoupeHead;
  onClose: () => void;
  children: ReactNode;
}

export function Loupe({ shot, color, head, onClose, children }: LoupeProps) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      role="region"
      aria-label={head.title}
      className="absolute z-30 flex flex-col rounded-card bg-background overflow-hidden"
      style={{
        inset: LOUPE_INSET,
        transformOrigin: `${shot.x - LOUPE_INSET}px ${shot.y - LOUPE_INSET}px`,
        willChange: "transform, opacity",
        boxShadow: `0 0 0 1px ${colorWithAlpha(color, 0.45)}, 0 0 48px ${colorWithAlpha(color, 0.12)}, 0 40px 90px -30px rgba(0,0,0,0.85)`,
      }}
      initial={reduce ? { opacity: 0 } : LAYER_HIDDEN}
      animate={LAYER_SHOWN}
      exit={reduce ? { opacity: 0 } : LAYER_HIDDEN}
      transition={reduce ? { duration: 0.2 } : LAYER_MOVE}
    >
      <LoupeHeader head={head} color={color} onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto px-[22px] py-[18px] 2xl:px-8 2xl:py-6 flex flex-col">{children}</div>
    </motion.section>
  );
}
