// One treemap rectangle. Area already carries the size (active KPIs); this
// file owns what the pixel SAYS: the band tint at coverage intensity, the
// hatched UNMEASURED share rising from the bottom edge, the optional identity
// stripe, and the label that only appears when the cell is big enough to hold
// it (otherwise the name lives in the hover <title>, never in 6px type).
//
// Unmeasured is hatched, never filled — a cell with 2 of 40 measured must not
// read like one with 40 of 40 (registry: unmeasurable-vs-zero).
import type { KeyboardEvent } from 'react';

import { BAND_COLOR, type KpiBand } from '../kpiOverviewModel';
import { bandFill } from '../kpiChartTheme';
import type { TreemapCell } from './squarify';

/** id of the 45° hatch pattern defined once per <svg> by TreemapHatchDefs. */
export const HATCH_ID = 'kpi-treemap-hatch';

const PAD = 2;
const LABEL_MIN_W = 80;
const LABEL_MIN_H = 28;

export function TreemapHatchDefs() {
  return (
    <defs>
      <pattern id={HATCH_ID} patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={8}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.35}
          strokeWidth={3}
        />
      </pattern>
    </defs>
  );
}

export interface TreemapCellProps {
  cell: TreemapCell;
  label: string;
  band: KpiBand;
  coverage: number;
  measured: number;
  total: number;
  ariaLabel: string;
  /** Group identity color drawn as a 3px left stripe. Status hues never do
   *  identity work, so this is the ONLY place a group's own color appears. */
  stripe?: string | null;
  onActivate: () => void;
}

export function TreemapCellShape({
  cell, label, band, coverage, measured, total, ariaLabel, stripe, onActivate,
}: TreemapCellProps) {
  const x = cell.x + PAD;
  const y = cell.y + PAD;
  const w = Math.max(0, cell.w - PAD * 2);
  const h = Math.max(0, cell.h - PAD * 2);
  if (w <= 0 || h <= 0) return null;

  const unmeasuredShare = total > 0 ? (total - measured) / total : 1;
  const hatchH = Math.min(h, h * unmeasuredShare);
  const counts = `${measured}/${total}`;
  const showLabel = w >= LABEL_MIN_W && h >= LABEL_MIN_H;

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      className="cursor-pointer"
    >
      <title>{ariaLabel}</title>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill={bandFill(BAND_COLOR[band], coverage)}
        stroke="var(--border)"
        strokeWidth={1}
      />
      {hatchH > 0 && (
        <rect
          x={x}
          y={y + h - hatchH}
          width={w}
          height={hatchH}
          rx={hatchH >= 4 ? 4 : 0}
          fill={`url(#${HATCH_ID})`}
          pointerEvents="none"
        />
      )}
      {stripe && (
        <rect x={x} y={y} width={Math.min(3, w)} height={h} fill={stripe} pointerEvents="none" />
      )}
      {showLabel && (
        <text x={x + 8} y={y + 16} className="typo-caption" fill="var(--foreground)" pointerEvents="none">
          {label.length * 7 > w - 16 ? `${label.slice(0, Math.max(1, Math.floor((w - 16) / 7)))}…` : label}
        </text>
      )}
      {showLabel && h >= 44 && (
        <text x={x + 8} y={y + 32} className="typo-caption" fill="var(--muted-foreground)" pointerEvents="none">
          {counts}
        </text>
      )}
    </g>
  );
}
