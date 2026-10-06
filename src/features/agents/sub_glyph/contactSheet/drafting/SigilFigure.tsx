/** SigilFigure - sheet 1's figure: the persona sigil drawn in line work, with
 *  a leader line from every region to the petal it names.
 *
 *  Construction first (a dashed guide circle, centre lines, the core ring),
 *  then each petal is drawn with its region: the outline runs on as a one-shot
 *  stroke, and so does the leader line, ending in a dot on the petal's tip.
 *  A petal takes its dimension's colour only once its region is inked; while
 *  the build drafts it, it is drawn in strong ink; while it asks, dashed. The
 *  glow behind the core grows with how much of the persona is crowned
 *  (Cinema's `presence`). Purely a figure: the regions are the doors. */
import { memo } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS, PETAL_ANGLES } from "@/features/shared/glyph";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { BOTTOM_ROW, TOP_ROW, anchorOf, petalPath, petalTip, type DrawingGeometry, type Ink } from "./sheetGeometry";

interface SigilFigureProps {
  geo: DrawingGeometry;
  w: number;
  h: number;
  drawn: ReadonlySet<GlyphDimension>;
  inks: Record<GlyphDimension, Ink>;
  /** 0..1, how much of the persona has been crowned into being. */
  presence: number;
  /** Compose: the figure is the ground under the composer. */
  quiet: boolean;
}

const DRAW = { duration: 0.9, ease: "easeOut" } as const;

function petalStroke(ink: Ink, dim: GlyphDimension): string {
  if (ink === "done" || ink === "asking") return DIM_META[dim].color;
  if (ink === "error") return "var(--status-error)";
  return ink === "drafting" ? "var(--ink-strong)" : "var(--ink-dim)";
}

export const SigilFigure = memo(function SigilFigure({ geo, w, h, drawn, inks, presence, quiet }: SigilFigureProps) {
  const { shouldAnimate } = useMotion();
  const { cx, cy, size } = geo.figure;
  if (size < 60) return null;
  const petal = petalPath(size);
  const anchors: Partial<Record<GlyphDimension, { x: number; y: number }>> = {};
  TOP_ROW.forEach((d, i) => { const b = geo.top[i]; if (b) anchors[d] = anchorOf(b, true); });
  BOTTOM_ROW.forEach((d, i) => { const b = geo.bottom[i]; if (b) anchors[d] = anchorOf(b, false); });
  const run = (on: boolean) => (shouldAnimate && on ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: DRAW } : {});

  return (
    <svg aria-hidden width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="pointer-events-none absolute inset-0 overflow-visible" style={{ opacity: quiet ? 0.55 : 1, transition: "opacity 0.8s ease" }}>
      <defs>
        <radialGradient id="dsh-core-glow">
          <stop offset="0%" stopColor="var(--bp-accent)" stopOpacity={0.1 + presence * 0.22} />
          <stop offset="100%" stopColor="var(--bp-accent)" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={size * 0.32} fill="url(#dsh-core-glow)" />
      {/* Construction: guide circle and centre lines. */}
      <circle cx={cx} cy={cy} r={size * 0.47} fill="none" stroke="var(--ink-faint)" strokeDasharray="3 5" />
      <line x1={cx - size * 0.52} y1={cy} x2={cx + size * 0.52} y2={cy} stroke="var(--ink-faint)" strokeDasharray="10 4 2 4" />
      <line x1={cx} y1={cy - size * 0.52} x2={cx} y2={cy + size * 0.52} stroke="var(--ink-faint)" strokeDasharray="10 4 2 4" />
      <circle cx={cx} cy={cy} r={size * 0.13} fill="none" stroke="var(--ink-dim)" />

      {GLYPH_DIMENSIONS.map((dim) => {
        if (!drawn.has(dim)) return null;
        const ink = inks[dim];
        const stroke = petalStroke(ink, dim);
        const tip = petalTip(dim, geo.figure);
        const a = anchors[dim];
        const lit = ink === "done";
        return (
          <g key={dim}>
            <g transform={`translate(${cx} ${cy}) rotate(${PETAL_ANGLES[dim]})`}>
              <motion.path
                d={petal}
                {...run(true)}
                fill={DIM_META[dim].color}
                stroke={stroke}
                strokeWidth={ink === "asking" ? 1.8 : 1.3}
                strokeDasharray={ink === "asking" ? "4 3" : undefined}
                style={{ fillOpacity: lit ? 0.18 : 0, transition: "fill-opacity 0.8s ease, stroke 0.6s ease" }}
              />
            </g>
            {a && (
              <>
                <motion.path d={`M ${a.x} ${a.y} L ${tip.x} ${tip.y}`} {...run(true)} fill="none" stroke={lit ? stroke : "var(--ink-dim)"} strokeWidth={1} style={{ transition: "stroke 0.6s ease" }} />
                <circle cx={tip.x} cy={tip.y} r={2.5} fill={lit ? stroke : "var(--ink)"} />
                <line x1={a.x - 5} y1={a.y} x2={a.x + 5} y2={a.y} stroke="var(--ink-dim)" />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
});
