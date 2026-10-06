/** DimensionDrawing - the left of a dimension's own sheet: sheet 1's geometry
 *  one level down. The dimension's emblem sits in a construction circle where
 *  the sigil sat; its parts (apps, channels, capabilities, lines) are drawn
 *  in the rows above and below it, numbered n.1, n.2 ..., each with a leader
 *  line to the circle and the same ink as its region on sheet 1. The parts
 *  are built up one beat apart, like sheet 1. */
import { useRef } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, channelIcon } from "@/features/shared/glyph";
import { ConnectorIcon, getConnectorMeta } from "@/lib/connectors/connectorMeta";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";
import { DimAuraMark } from "../cinema/FramePictures";
import { anchorOf, drawingGeometry, towards, type Ink } from "./sheetGeometry";
import type { SubPart } from "./subParts";
import { useBoxSize } from "./useBoxSize";
import { DraftPart } from "./DraftPart";
import { DimensionLine, Lettered } from "./sheetParts";
import { COPY } from "./copy";

interface DimensionDrawingProps {
  dim: GlyphDimension;
  n: number;
  ink: Ink;
  parts: SubPart[];
  more: number;
  /** Parts drawn so far. */
  shown: number;
  caption: string | null;
  partRef: (i: number) => (el: HTMLElement | null) => void;
}

function PartMark({ part }: { part: SubPart }) {
  if (part.app) return <span className="inline-flex shrink-0"><ConnectorIcon meta={getConnectorMeta(part.app)} size="w-3.5 h-3.5" /></span>;
  if (part.channel) {
    const Icon = channelIcon(part.channel);
    return <Icon className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />;
  }
  return null;
}

export function DimensionDrawing({ dim, n, ink, parts, more, shown, caption, partRef }: DimensionDrawingProps) {
  const { shouldAnimate } = useMotion();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { w, h } = useBoxSize(boxRef);
  const k = parts.length;
  const topN = Math.ceil(k / 2);
  const geo = drawingGeometry(w, h, topN, k - topN, 48);
  const { cx, cy, size } = geo.figure;
  const r = size * 0.36;
  const color = DIM_META[dim].color;
  const boxes = [...geo.top.map((b) => ({ b, top: true })), ...geo.bottom.map((b) => ({ b, top: false }))];

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <div ref={boxRef} className="relative min-h-0 flex-1" data-testid="drafting-dimension-drawing">
        {size >= 60 && (
          <svg aria-hidden width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="pointer-events-none absolute inset-0 overflow-visible">
            <circle cx={cx} cy={cy} r={size * 0.47} fill="none" stroke="var(--ink-faint)" strokeDasharray="3 5" />
            <line x1={cx - size * 0.52} y1={cy} x2={cx + size * 0.52} y2={cy} stroke="var(--ink-faint)" strokeDasharray="10 4 2 4" />
            <line x1={cx} y1={cy - size * 0.52} x2={cx} y2={cy + size * 0.52} stroke="var(--ink-faint)" strokeDasharray="10 4 2 4" />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={ink === "done" ? color : "var(--ink-dim)"} strokeDasharray={ink === "done" ? undefined : "5 4"} />
            {boxes.slice(0, shown).map(({ b, top }, i) => {
              const a = anchorOf(b, top);
              const end = towards(geo.figure, a, r);
              return (
                <g key={parts[i]?.id ?? i}>
                  <motion.path
                    d={`M ${a.x} ${a.y} L ${end.x} ${end.y}`}
                    initial={shouldAnimate ? { pathLength: 0 } : false}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                    fill="none" stroke={ink === "done" ? color : "var(--ink-dim)"} strokeWidth={1}
                  />
                  <circle cx={end.x} cy={end.y} r={2.5} fill={ink === "done" ? color : "var(--ink)"} />
                </g>
              );
            })}
          </svg>
        )}
        {size >= 60 && (
          <span className="absolute grid place-items-center" style={{ left: cx - size * 0.2, top: cy - size * 0.2, width: size * 0.4, height: size * 0.4 }}>
            <DimAuraMark dim={dim} size={Math.round(size * 0.34)} lit={ink === "done"} />
          </span>
        )}
        {boxes.slice(0, shown).map(({ b }, i) => {
          const part = parts[i];
          if (!part) return null;
          return (
            <DraftPart
              key={part.id} box={b} n={`${n}.${i + 1}`} label={part.title} ink={ink} color={color}
              caption={part.detail ?? null} mark={<PartMark part={part} />} partRef={partRef(i)}
            />
          );
        })}
        <div className="absolute flex items-end justify-center px-4 text-center" style={{ left: geo.strip.x, top: geo.strip.y, width: geo.strip.w, height: geo.strip.h }}>
          {caption ? (
            <span className="line-clamp-2 max-w-full" style={{ ...LETTERING, color: "var(--ink-strong)" }}><Lettered text={caption} /></span>
          ) : (
            <span className="typo-body text-foreground">{COPY.nested.nothing}</span>
          )}
        </div>
      </div>
      {k > 0 && <DimensionLine label={COPY.dimLine.parts(k + more)} />}
    </div>
  );
}
