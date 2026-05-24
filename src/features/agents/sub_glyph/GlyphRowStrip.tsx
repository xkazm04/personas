import { Plus } from "lucide-react";
import { DIM_META, PETAL_ANGLES, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphRow } from "@/features/shared/glyph";
import { debtText } from '@/i18n/DebtText';


interface MiniSigilProps {
  row: GlyphRow;
  active: boolean;
  hovered?: boolean;
  onClick: () => void;
}

function MiniSigil({ row, active, hovered, onClick }: MiniSigilProps) {
  const size = 60;
  const center = size / 2;
  const petalOuter = size * 0.42;
  const petalInner = size * 0.15;
  const linkedCount = Object.values(row.presence).filter((p) => p === "linked").length;
  const petalPath =
    `M 0 -${petalInner} C ${size * 0.06} -${petalOuter * 0.49}, ${size * 0.06} -${petalOuter * 0.77}, 0 -${petalOuter} ` +
    `C -${size * 0.06} -${petalOuter * 0.77}, -${size * 0.06} -${petalOuter * 0.49}, 0 -${petalInner} Z`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={row.title}
      className={`relative shrink-0 rounded-full transition-all ${active ? "ring-2 ring-primary/60" : hovered ? "ring-1 ring-foreground/30" : "hover:ring-1 hover:ring-foreground/20"}`}
      style={{ width: size + 8, height: size + 8, padding: 4 }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={petalOuter} fill="none" stroke="currentColor" strokeOpacity={active ? 0.15 : 0.08} />
        {GLYPH_DIMENSIONS.map((dim) => {
          const angle = PETAL_ANGLES[dim];
          const meta = DIM_META[dim];
          const presence = row.presence[dim];
          return (
            <g key={dim} transform={`translate(${center} ${center}) rotate(${angle})`}>
              <path
                d={petalPath}
                fill={presence !== "none" ? meta.color : "transparent"}
                fillOpacity={presence === "linked" ? (active ? 0.9 : 0.7) : presence === "shared" ? 0.3 : 0}
                stroke={meta.color}
                strokeWidth="0.9"
                strokeOpacity={presence !== "none" ? 0.8 : 0.2}
                strokeDasharray={presence === "none" ? "2,3" : undefined}
              />
            </g>
          );
        })}
        <circle cx={center} cy={center} r={size * 0.14} fill="currentColor" fillOpacity={active ? 0.2 : 0.1} />
        <text x={center} y={center + 2} textAnchor="middle" dominantBaseline="middle" className="fill-current"
          style={{ fontSize: `${size * 0.22}px`, fontWeight: 700 }}>
          {linkedCount}
        </text>
      </svg>
    </button>
  );
}

interface GlyphRowStripProps {
  rows: GlyphRow[];
  activeIndex: number;
  hoveredIndex: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
  onAdd: () => void;
  canAdd: boolean;
  /** Stack the mini sigils vertically (column) instead of horizontally.
   *  Used by the build surface to anchor the strip to the left of the
   *  sigil so the active title can sit centred above the canvas. */
  vertical?: boolean;
}

/** Labels removed from each mini — the full title renders in the shared
 *  header row beneath the strip so it never truncates and doesn't pile up. */
export function GlyphRowStrip({
  rows, activeIndex, hoveredIndex, onSelect, onHover, onAdd, canAdd, vertical,
}: GlyphRowStripProps) {
  if (rows.length <= 1 && !canAdd) return null;
  const wrapperClass = vertical
    ? "flex flex-col items-center gap-3"
    : "flex items-center gap-3 flex-wrap justify-center";
  return (
    <div className={wrapperClass}>
      {rows.map((row, i) => (
        <div
          key={row.id}
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
        >
          <MiniSigil
            row={row}
            active={i === activeIndex}
            hovered={i === hoveredIndex && i !== activeIndex}
            onClick={() => onSelect(i)}
          />
        </div>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="w-[68px] h-[68px] shrink-0 rounded-full border border-dashed border-border/40 hover:border-primary/40 flex items-center justify-center text-foreground hover:text-foreground transition-colors"
          title={debtText("auto_add_capability_f36f0950")}
        >
          <Plus className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
