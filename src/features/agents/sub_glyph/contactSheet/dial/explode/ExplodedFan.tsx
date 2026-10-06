/** ExplodedFan - the sector, pulled out of the dial and magnified. It opens
 *  east as a 70° fan drawn on the SAME graduated scale (the sector's real 45°,
 *  stretched, with the dial's own degree numerals), projection lines run back
 *  to where the dial's centre would be, an angle dimension spans its inner
 *  edge, and the dimension's sub-parts (connectors, capabilities, triggers,
 *  channels, events, notes) are sub-sectors in the main frame's ink states,
 *  numbered, each with a leader-line label. It builds up like the dial does:
 *  outline and scale, then the dimension, then one sub-part per beat, with the
 *  same sweep arm pointing at the part drawn last. */
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, PETAL_ANGLES } from "@/features/shared/glyph";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING, useDraftSteps } from "../../blueprint";
import { FAN_HALF, HALF_SPAN, fanAnnulus, fanLayout, fanPolar, type Pt } from "../dialGeometry";
import type { Ink } from "../dialMarks";
import { SectorInk } from "../figure/SectorInk";
import { SweepArm } from "../figure/SweepArm";
import { FanScale } from "./FanScale";
import { COPY } from "../copy";

/** A magnified replay is quicker than the dial's first drawing. */
const FAN_PACE = { draw: 620, catchUp: 300 } as const;
const MAX_PARTS = 8;
const GAP = 1.6;

interface ExplodedFanProps {
  dim: GlyphDimension;
  size: { w: number; h: number };
  parts: string[];
  partInk: Ink;
  populated: boolean;
  drawKey: string;
  /** Receives the fan's lower outer corner, where the controls' leader starts. */
  anchorRef: (el: HTMLSpanElement | null) => void;
}

const clip = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function ExplodedFan({ dim, size, parts, partInk, populated, drawKey, anchorRef }: ExplodedFanProps) {
  const { shouldAnimate } = useMotion();
  const F = fanLayout(size.w, size.h);
  const extra = Math.max(0, parts.length - MAX_PARTS);
  const shown = parts.slice(0, MAX_PARTS);
  const steps = useDraftSteps(drawKey, 2 + shown.length, FAN_PACE);
  if (!F) return null;
  const { apex, rO, rI } = F;
  const color = DIM_META[dim].color;
  const theta = PETAL_ANGLES[dim];
  const bandIn = rI + 4, bandOut = rO - 30;
  const n = shown.length;
  const each = n ? (2 * FAN_HALF) / n : 0;
  const drawnParts = Math.max(0, steps - 2);
  const latestPhi = drawnParts > 0 ? -FAN_HALF + (drawnParts - 0.5) * each : 0;
  const corner = fanPolar(apex, rO, FAN_HALF);
  const edge = (phi: number) => { const p = fanPolar(apex, rI, phi); return `M${apex.x} ${apex.y}L${p.x} ${p.y}`; };
  const draw = shouldAnimate ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 1, ease: "easeOut" as const } } : {};
  const dimR = rI - 14;
  const chip: Pt = fanPolar(apex, dimR, 0);
  const pin = fanPolar(apex, dimR, -FAN_HALF), pout = fanPolar(apex, dimR, FAN_HALF);

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="dial-exploded-fan">
      <svg width={size.w} height={size.h} className="absolute inset-0" aria-hidden>
        <path d={`${edge(-FAN_HALF)}${edge(FAN_HALF)}`} stroke="var(--ink-faint)" strokeDasharray="2 5" fill="none" />
        <motion.path d={fanAnnulus(apex, rI, rO, -FAN_HALF, FAN_HALF)} fill="color-mix(in srgb, var(--background) 70%, transparent)" stroke="var(--ink)" strokeWidth={1.2} {...draw} />
        {steps >= 1 && <FanScale apex={apex} rO={rO} theta={theta} />}
        {steps >= 2 && (
          <motion.g initial={shouldAnimate ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
            <path d={`M${pin.x} ${pin.y}A${dimR} ${dimR} 0 0 1 ${pout.x} ${pout.y}`} fill="none" stroke="var(--ink-dim)" />
            {[-FAN_HALF, FAN_HALF].map((phi) => {
              const a = fanPolar(apex, dimR - 5, phi), b = fanPolar(apex, dimR + 5, phi);
              return <path key={phi} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke="var(--ink-dim)" />;
            })}
            <rect x={chip.x - 20} y={chip.y - 9} width={40} height={18} rx={4} fill="var(--background)" stroke="var(--ink-dim)" />
            <text x={chip.x} y={chip.y + 4} textAnchor="middle" style={{ ...LETTERING, fontSize: 11 }} fill="var(--ink-strong)">{`${HALF_SPAN * 2}°`}</text>
          </motion.g>
        )}
        {n === 0 && steps >= 2 && (
          <g>
            <path d={fanAnnulus(apex, bandIn, bandOut, -FAN_HALF + 2, FAN_HALF - 2)} fill="none" stroke="var(--ink-dim)" strokeDasharray="3 4" />
            <text x={apex.x + (bandIn + bandOut) / 2} y={apex.y + 4} textAnchor="middle" style={{ ...LETTERING, fontSize: 11 }} fill="var(--ink-dim)">{COPY.fan.empty}</text>
          </g>
        )}
        {shown.slice(0, drawnParts).map((text, i) => {
          const p0 = -FAN_HALF + i * each + GAP / 2, p1 = p0 + each - GAP, pm = (p0 + p1) / 2;
          const d = fanAnnulus(apex, bandIn, bandOut, p0, p1);
          const mid = fanPolar(apex, (bandIn + bandOut) / 2, pm);
          const box = { x: mid.x - (bandOut - bandIn), y: mid.y - (bandOut - bandIn), size: 2 * (bandOut - bandIn) };
          const l0 = fanPolar(apex, bandOut, pm), l1 = fanPolar(apex, rO + 8, pm), at = fanPolar(apex, rO + 12, pm);
          const label = i === n - 1 && extra ? `${clip(text, 16)}  ${COPY.fan.more(extra)}` : clip(text);
          return (
            <motion.g key={`${i}-${text}`} initial={shouldAnimate ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
              <SectorInk d={d} ink={partInk} color={color} populated={populated} box={box} />
              <circle cx={mid.x} cy={mid.y} r={10} fill="var(--background)" stroke={populated ? color : "var(--ink)"} />
              <text x={mid.x} y={mid.y + 3.5} textAnchor="middle" style={{ ...LETTERING, fontSize: 10, letterSpacing: 0 }} fill="var(--ink-strong)">{String(i + 1).padStart(2, "0")}</text>
              <motion.path d={`M${l0.x} ${l0.y}L${l1.x} ${l1.y}`} stroke="var(--ink-strong)" {...draw} />
              <text x={at.x} y={at.y} dy={4} transform={`rotate(${pm} ${at.x} ${at.y})`} style={{ ...LETTERING, fontSize: 11 }} fill="var(--ink-strong)">{label}</text>
            </motion.g>
          );
        })}
      </svg>
      <SweepArm pivot={apex} r0={rI} r1={rO - 2} angle={steps >= 1 ? latestPhi + 90 : null} working={drawnParts < n} rest={90} />
      <span ref={anchorRef} aria-hidden className="absolute h-px w-px" style={{ left: corner.x, top: corner.y }} />
      <span className="sr-only">{shown.join(", ")}</span>
    </div>
  );
}

