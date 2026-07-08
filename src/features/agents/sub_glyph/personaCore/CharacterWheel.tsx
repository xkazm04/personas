/** CharacterWheel — a live radial sigil of the persona. Five axis sectors around a
 *  ring; each sector's glow encodes how many of that axis's traits are selected, so
 *  the persona's CHARACTER SHAPE reads at a glance without any text. The centre disc
 *  is tinted by disposition (cool = cautious → warm = bold) and carries the conflict
 *  style's glyph. Pure visualization: selection happens in the trait nodes beside it.
 */
import { motion } from "framer-motion";
import { Atom } from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { TRAIT_AXES, TRAIT_CATALOG, CONFLICT_STYLES } from "./coreTraits";
import type { PersonaCore } from "./usePersonaCore";

const SIZE = 216, C = SIZE / 2, R_IN = 46, R_OUT = 92, GAP = 0.05;
const START = -Math.PI / 2;
const SPAN = (Math.PI * 2) / TRAIT_AXES.length;

const pt = (r: number, a: number) => [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
function sectorPath(a0: number, a1: number) {
  const [x1, y1] = pt(R_OUT, a0), [x2, y2] = pt(R_OUT, a1);
  const [x3, y3] = pt(R_IN, a1), [x4, y4] = pt(R_IN, a0);
  return `M${x1},${y1} A${R_OUT},${R_OUT} 0 0 1 ${x2},${y2} L${x3},${y3} A${R_IN},${R_IN} 0 0 0 ${x4},${y4} Z`;
}

export function CharacterWheel({ core }: { core: PersonaCore }) {
  const { state } = core;
  const sel = new Set(state.traits);
  const disp = state.disposition;
  const dispColor = disp < 0.34 ? "#60a5fa" : disp > 0.66 ? "#fb7185" : "#a78bfa";
  const conflict = CONFLICT_STYLES.find((c) => c.id === state.conflictStyle);
  const CenterIcon = conflict?.icon ?? Atom;

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {TRAIT_AXES.map((axis, i) => {
          const total = TRAIT_CATALOG.filter((t) => t.axis === axis.id).length;
          const chosen = TRAIT_CATALOG.filter((t) => t.axis === axis.id && sel.has(t.id)).length;
          const frac = total ? chosen / total : 0;
          const a0 = START + i * SPAN + GAP, a1 = START + (i + 1) * SPAN - GAP;
          return (
            <motion.path key={axis.id} d={sectorPath(a0, a1)}
              initial={false}
              animate={{ opacity: 0.12 + frac * 0.72 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              fill={axis.color}
              stroke={chosen ? colorWithAlpha(axis.color, 0.9) : "transparent"} strokeWidth={1} />
          );
        })}
        {/* centre disc */}
        <circle cx={C} cy={C} r={R_IN - 4} fill={colorWithAlpha(dispColor, 0.18)} stroke={colorWithAlpha(dispColor, 0.55)} strokeWidth={1.5} />
      </svg>

      {/* axis glyphs, placed at each sector's mid-angle */}
      {TRAIT_AXES.map((axis, i) => {
        const AxisIcon = axis.icon;
        const mid = START + (i + 0.5) * SPAN;
        const [x, y] = pt(R_OUT + 15, mid);
        const chosen = TRAIT_CATALOG.filter((t) => t.axis === axis.id && sel.has(t.id)).length;
        return (
          <Tooltip key={axis.id} content={`${axis.label} — ${chosen} selected`}>
            <span className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center" style={{ left: x, top: y }}>
              <AxisIcon className="w-4 h-4" style={{ color: chosen ? axis.color : colorWithAlpha(axis.color, 0.4) }} />
            </span>
          </Tooltip>
        );
      })}

      {/* centre glyph — conflict style + disposition tint */}
      <span className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center" style={{ left: C, top: C }}>
        <CenterIcon className="w-6 h-6" style={{ color: dispColor }} />
      </span>
    </div>
  );
}
