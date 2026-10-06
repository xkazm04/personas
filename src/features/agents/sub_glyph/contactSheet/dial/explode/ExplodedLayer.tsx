/** ExplodedLayer - the nested layer on a sector click, in the dial's idiom.
 *  No camera push and no loupe: the dial dims and sleeps where it is (the
 *  layout fades and shrinks it a touch, transform + opacity only), the clicked
 *  sector is PULLED OUT along its bisector (FlyingSector), and in the open
 *  stage it becomes an exploded view: the magnified fan on the left, the
 *  dimension's controls on the right, joined by a leader line from the fan's
 *  corner onto the controls' bus. Esc or the back control re-seats it. */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../../blueprint";
import type { SheetState } from "../../cinema/useSheetState";
import { frameStatus } from "../../cinema/FrameLayer";
import { frameNumber } from "../../cinema/sheetModel";
import type { DialLayout } from "../dialGeometry";
import { partsOf, type Ink } from "../dialMarks";
import { ExplodedFan } from "./ExplodedFan";
import { ExplodedControls } from "./ExplodedControls";
import { ExplodedLeader, useLeaderGeometry } from "./ExplodedLeader";
import { FlyingSector } from "./FlyingSector";
import { COPY } from "../copy";

interface ExplodedLayerProps {
  dim: GlyphDimension;
  s: SheetState;
  rows: GlyphRow[];
  label: string;
  desc: string;
  scene: string;
  layout: DialLayout;
  stage: { w: number; h: number };
  ink: Ink;
  populated: boolean;
  drawKey: string;
  onClose: () => void;
}

export function ExplodedLayer({ dim, s, rows, label, desc, scene, layout, stage, ink, populated, drawKey, onClose }: ExplodedLayerProps) {
  const { shouldAnimate } = useMotion();
  const rootRef = useRef<HTMLElement | null>(null);
  const fanBox = useRef<HTMLDivElement | null>(null);
  const [fanSize, setFanSize] = useState({ w: 0, h: 0 });
  const [anchorEl, setAnchorEl] = useState<HTMLSpanElement | null>(null);
  const [busEl, setBusEl] = useState<HTMLDivElement | null>(null);
  const color = DIM_META[dim].color;
  const value = s.frameValues[dim];
  const status = frameStatus(s.frameStates[dim], s.values[dim]);
  const partInk: Ink = ink === "pending" ? (value ? "drafting" : "pending") : ink;

  useLayoutEffect(() => {
    const el = fanBox.current;
    if (!el) return;
    const measure = () => setFanSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const leader = useLeaderGeometry(rootRef, anchorEl, busEl);
  const setAnchor = useCallback((el: HTMLSpanElement | null) => setAnchorEl(el), []);
  const setBus = useCallback((el: HTMLDivElement | null) => setBusEl(el), []);
  const enter = (delay: number) => (shouldAnimate
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.2 } }, transition: { duration: 0.45, delay } }
    : {});

  return (
    <motion.section
      ref={rootRef}
      role="region"
      aria-label={label}
      data-testid="dial-exploded"
      className="absolute inset-0 z-20 flex flex-col"
      initial={{ opacity: 1 }}
      exit={{ opacity: 1, transition: { duration: 0.6 } }}
    >
      <FlyingSector dim={dim} c={layout.c} R={layout.R} stage={stage} ink={ink} populated={populated} />
      <motion.header className="relative flex flex-shrink-0 items-center gap-3 px-3 pt-2 pb-1" {...enter(0.3)}>
        <Button variant="secondary" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onClose} aria-label={COPY.fan.back} autoFocus>
          <kbd className="font-mono typo-caption px-1.5 rounded-interactive border border-card-border text-foreground">{COPY.fan.esc}</kbd>
        </Button>
        <span style={{ ...LETTERING, color }} aria-hidden>{`▸ ${frameNumber(dim)}`}</span>
        <h2 className="m-0 min-w-0 truncate typo-heading-lg uppercase tracking-[0.08em]" style={{ color }}>{label}</h2>
        <span className="typo-caption px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ borderColor: status.strong ? color : "var(--ink-dim)", color: status.strong ? color : undefined }}>
          {status.label}
        </span>
        {value?.caption && <span className="hidden lg:inline min-w-0 truncate typo-body text-foreground">{value.caption}</span>}
        <span className="ml-auto hidden md:inline whitespace-nowrap" style={{ ...LETTERING, color: "var(--ink-dim)" }}>{scene}</span>
      </motion.header>
      <div className="relative flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(300px,420px)] gap-8 px-4 pb-3">
        <motion.div ref={fanBox} className="min-h-0 min-w-0" {...enter(0.42)}>
          {fanSize.w > 0 && (
            <ExplodedFan
              dim={dim} size={fanSize} parts={partsOf(dim, value)} partInk={partInk} populated={populated}
              drawKey={`${drawKey}:fan:${dim}`} anchorRef={setAnchor}
            />
          )}
        </motion.div>
        <motion.div className="min-h-0 min-w-0" {...enter(0.5)}>
          <ExplodedControls
            dim={dim} label={label} desc={desc} value={s.values[dim]} isCompose={s.isCompose}
            item={s.cfg.items.find((i) => i.dim === dim)} rows={rows} busRef={setBus}
          />
        </motion.div>
      </div>
      {leader && <ExplodedLeader geometry={leader} />}
    </motion.section>
  );
}
