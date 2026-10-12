/** ExplodedLayer - the dial's nested layer, in its idiom. No camera push and
 *  no loupe: the dial dims and sleeps where it is (the layout fades and
 *  shrinks it, transform + opacity only), the sector is PULLED OUT along its
 *  bisector (FlyingSector), and in the open stage it becomes an exploded
 *  view: the magnified fan on the left, a column on the right, joined by a
 *  leader line from the fan's corner onto the column's bus. The column is
 *  the caller's: the dimension's controls on a sector click, the question
 *  being asked through the question round. A question that belongs to no
 *  dimension has no sector to pull out, so it opens as the column alone, in
 *  the theme's ink. Esc or the back control re-seats it. */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../../blueprint";
import { frameNumber } from "../../cinema/sheetModel";
import type { DialLayout } from "../dialGeometry";
import type { Ink } from "../dialMarks";
import { THEME_INK } from "../tint";
import { ExplodedFan } from "./ExplodedFan";
import { ExplodedLeader, useLeaderGeometry } from "./ExplodedLeader";
import { FlyingSector } from "./FlyingSector";
import { COPY } from "../copy";

export interface ExplodedHead {
  label: string;
  status: { label: string; strong: boolean };
  /** The value line beside the title (wide stages only). */
  caption?: string | null;
  /** Right-aligned context: the scene, or where the round stands. */
  context: string;
}

interface ExplodedLayerProps {
  dim: GlyphDimension | null;
  head: ExplodedHead;
  layout: DialLayout;
  stage: { w: number; h: number };
  ink: Ink;
  populated: boolean;
  parts: string[];
  drawKey: string;
  onClose: () => void;
  testId: string;
  /** The right-hand column; it hangs off the bus it hands to `busRef`. */
  side: (busRef: (el: HTMLDivElement | null) => void) => React.ReactNode;
}

export function ExplodedLayer({ dim, head, layout, stage, ink, populated, parts, drawKey, onClose, testId, side }: ExplodedLayerProps) {
  const { shouldAnimate } = useMotion();
  const rootRef = useRef<HTMLElement | null>(null);
  const fanBox = useRef<HTMLDivElement | null>(null);
  const [fanSize, setFanSize] = useState({ w: 0, h: 0 });
  const [anchorEl, setAnchorEl] = useState<HTMLSpanElement | null>(null);
  const [busEl, setBusEl] = useState<HTMLDivElement | null>(null);
  const color = dim ? DIM_META[dim].color : THEME_INK;
  const partInk: Ink = ink === "pending" ? (parts.length ? "drafting" : "pending") : ink;

  useLayoutEffect(() => {
    const el = fanBox.current;
    if (!el) return;
    const measure = () => setFanSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const leader = useLeaderGeometry(rootRef, dim ? anchorEl : null, busEl);
  const setAnchor = useCallback((el: HTMLSpanElement | null) => setAnchorEl(el), []);
  const setBus = useCallback((el: HTMLDivElement | null) => setBusEl(el), []);
  const enter = (delay: number) => (shouldAnimate
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.2 } }, transition: { duration: 0.45, delay } }
    : {});

  return (
    <motion.section
      ref={rootRef}
      role="region"
      aria-label={head.label}
      data-testid={testId}
      className="absolute inset-0 z-20 flex flex-col"
      initial={{ opacity: 1 }}
      exit={{ opacity: 1, transition: { duration: 0.6 } }}
    >
      {dim && <FlyingSector dim={dim} c={layout.c} R={layout.R} stage={stage} ink={ink} populated={populated} />}
      <motion.header className="relative flex flex-shrink-0 items-center gap-3 px-3 pt-2 pb-1" {...enter(0.3)}>
        <Button variant="secondary" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onClose} aria-label={COPY.fan.back} autoFocus={!!dim}>
          <kbd className="font-mono typo-caption px-1.5 rounded-interactive border border-card-border text-foreground">{COPY.fan.esc}</kbd>
        </Button>
        <span style={{ ...LETTERING, color }} aria-hidden>{`▸ ${dim ? frameNumber(dim) : "00"}`}</span>
        <h2 className="m-0 min-w-0 truncate typo-heading-lg uppercase tracking-[0.08em]" style={{ color }}>{head.label}</h2>
        <span className="typo-caption px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ borderColor: head.status.strong ? color : "var(--ink-dim)", color: head.status.strong ? color : undefined }}>
          {head.status.label}
        </span>
        {head.caption && <span className="hidden lg:inline min-w-0 truncate typo-body text-foreground">{head.caption}</span>}
        <span className="ml-auto hidden md:inline whitespace-nowrap" style={{ ...LETTERING, color: "var(--ink-dim)" }}>{head.context}</span>
      </motion.header>
      <div className={`relative flex-1 min-h-0 px-4 pb-3 ${dim ? "grid grid-cols-[minmax(0,1fr)_minmax(320px,460px)] gap-8" : "flex justify-center"}`}>
        {dim && (
          <motion.div ref={fanBox} className="min-h-0 min-w-0" {...enter(0.42)}>
            {fanSize.w > 0 && (
              <ExplodedFan dim={dim} size={fanSize} parts={parts} partInk={partInk} populated={populated} drawKey={`${drawKey}:fan:${dim}`} anchorRef={setAnchor} />
            )}
          </motion.div>
        )}
        <motion.div className={`min-h-0 min-w-0 ${dim ? "" : "w-full max-w-[640px]"}`} {...enter(0.5)}>
          {side(setBus)}
        </motion.div>
      </div>
      {leader && <ExplodedLeader geometry={leader} color={color} />}
    </motion.section>
  );
}
