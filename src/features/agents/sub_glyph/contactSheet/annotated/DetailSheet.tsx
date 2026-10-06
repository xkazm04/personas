/** DetailSheet - a frame's nested layer, drawn as a DETAIL of the sheet.
 *
 *  The camera move is Cinema's (the sheet pushes in and sleeps; this sheet
 *  grows out of the frame it details), but the layer is a drawing on the same
 *  construction grid: a lettered title strip ("DETAIL 03 · APPS", where the
 *  frame stands, the scene), the frame redrawn large on the left, and its
 *  controls on the right as lettered zones, each tied to the figure by a
 *  leader that lands on its tab. The detail builds up with the same timed
 *  pen as the sheet (figure, then each zone, then each note), keyed on this
 *  layer, while every control inside the zones is live from the start. */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { useMotion, useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import Button from "@/features/shared/components/buttons/Button";
import { LETTERING, useDraftSteps } from "../blueprint";
import { LAYER_HIDDEN, LAYER_MOVE, LAYER_SHOWN, type Shot } from "../cinema/useCamera";
import { frameNumber } from "../cinema/sheetModel";
import type { Ink, Note } from "./annotationModel";
import { DetailFigure } from "./DetailFigure";
import { DetailZone, type Zone } from "./DetailZones";
import { leaderPath, useLeaders } from "./useLeaders";
import { dimInk } from "./ink";
import { COPY } from "./copy";

const INSET = 6;
const MAX_ZONES = 6;

interface DetailSheetProps {
  shot: Shot;
  dim: GlyphDimension;
  label: string;
  ink: Ink;
  picture: Parameters<typeof DetailFigure>[0]["picture"];
  caption: string;
  notes: Note[];
  zones: Zone[];
  scene: string;
  drawKey: string;
  onClose: () => void;
}

function DetailHeader({ dim, label, ink, scene, onClose }: { dim: GlyphDimension; label: string; ink: Ink; scene: string; onClose: () => void }) {
  const color = DIM_META[dim].color;
  return (
    <header className="flex flex-shrink-0 items-center gap-4 px-[18px] py-3" style={{ borderBottom: "1px solid var(--ink-dim)", boxShadow: "0 3px 0 -2px var(--ink-faint)" }}>
      <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onClose} aria-label={COPY.detail.back}>
        <kbd className="rounded-interactive border border-card-border px-1.5 font-mono typo-caption text-foreground">{COPY.detail.esc}</kbd>
      </Button>
      <h2 className="m-0 min-w-0 truncate" style={{ ...LETTERING, fontSize: 15, letterSpacing: "0.16em", color: "var(--ink-strong)" }}>
        {COPY.detail.title(frameNumber(dim), label)}
      </h2>
      <span
        className="whitespace-nowrap rounded-full px-2 py-0.5"
        style={{ ...LETTERING, fontSize: 10.5, color: ink === "inked" || ink === "needs" ? color : "var(--ink)", border: `1px ${ink === "inked" ? "solid" : "dashed"} ${ink === "inked" ? dimInk(color) : "var(--ink-dim)"}` }}
      >
        {COPY.detail.status[ink]}
      </span>
      <span className="ml-auto hidden whitespace-nowrap md:inline" style={{ ...LETTERING, fontSize: 11, color: "var(--ink)" }}>{scene}</span>
    </header>
  );
}

export function DetailSheet({ shot, dim, label, ink, picture, caption, notes, zones, scene, drawKey, onClose }: DetailSheetProps) {
  const reduce = useReducedMotion();
  const { shouldAnimate } = useMotion();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [figure, setFigure] = useState<HTMLDivElement | null>(null);
  const [zoneEls, setZoneEls] = useState<(HTMLElement | null)[]>([]);
  // Stable ref callbacks, one per zone slot: a fresh callback each render would
  // detach and re-attach every zone, and each attach is a state update.
  const zoneRefs = useMemo(
    () => Array.from({ length: MAX_ZONES }, (_, i) => (el: HTMLElement | null) =>
      setZoneEls((prev) => (prev[i] === el ? prev : Object.assign([...prev], { [i]: el })))),
    [],
  );

  const steps = useMemo(() => ["figure", ...zones.map((z) => `zone:${z.id}`), ...notes.map((n) => n.id)], [zones, notes]);
  const count = useDraftSteps(drawKey, steps.length);
  const drawn = useMemo(() => new Set(steps.slice(0, count)), [steps, count]);
  const leaders = useLeaders(root, figure, zoneEls, Math.min(zones.length, MAX_ZONES));
  const figureInk: Ink = ink === "inked" && !drawn.has("figure") ? "drafting" : ink;
  const color = DIM_META[dim].color;

  return (
    <motion.section
      role="region"
      aria-label={COPY.detail.title(frameNumber(dim), label)}
      data-testid="annotated-detail"
      className="bp-root absolute z-30 flex flex-col overflow-hidden rounded-card bg-background"
      style={{
        inset: INSET,
        transformOrigin: `${shot.x - INSET}px ${shot.y - INSET}px`,
        willChange: "transform, opacity",
        boxShadow: `0 0 0 1px ${colorWithAlpha(color, 0.4)}, 0 40px 90px -30px rgba(0,0,0,0.85)`,
        ["--paper" as string]: "var(--background)",
      }}
      initial={reduce ? { opacity: 0 } : LAYER_HIDDEN}
      animate={LAYER_SHOWN}
      exit={reduce ? { opacity: 0 } : LAYER_HIDDEN}
      transition={reduce ? { duration: 0.2 } : LAYER_MOVE}
    >
      <DetailHeader dim={dim} label={label} ink={ink} scene={scene} onClose={onClose} />
      <div className="bp-grid min-h-0 flex-1 overflow-y-auto" style={{ outline: "1px solid var(--ink-faint)", outlineOffset: -8 }}>
        <div ref={setRoot} className="relative mx-auto grid w-full max-w-[1180px] grid-cols-1 items-start gap-x-20 gap-y-8 px-8 py-8 sm:grid-cols-[minmax(240px,360px)_minmax(0,1fr)]">
          <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {leaders.map((l) => (
              <g key={l.letter}>
                {drawn.has(`zone:${zones[l.index]?.id}`) && (
                  <motion.path
                    d={leaderPath(l)} fill="none" stroke="var(--ink-dim)" strokeWidth={1}
                    initial={shouldAnimate ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: "easeInOut" }}
                  />
                )}
                <circle cx={l.from.x} cy={l.from.y} r={9} fill="var(--background)" stroke={dimInk(color)} strokeWidth={1} />
                <text x={l.from.x} y={l.from.y} textAnchor="middle" dominantBaseline="central" style={{ ...LETTERING, fontSize: 10, letterSpacing: 0, fill: "var(--ink-strong)" }}>{l.letter}</text>
              </g>
            ))}
          </svg>
          <DetailFigure ref={setFigure} dim={dim} ink={figureInk} picture={picture} caption={caption} notes={notes} drawn={drawn} />
          <div className="relative flex min-w-0 flex-col gap-7">
            {zones.slice(0, MAX_ZONES).map((z, i) => (
              <DetailZone key={z.id} zone={z} index={i} drawn={drawn.has(`zone:${z.id}`)} zoneRef={zoneRefs[i]!} />
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
