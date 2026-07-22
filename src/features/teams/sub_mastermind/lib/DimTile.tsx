// Shared rectangular dimension tile with band-driven level of detail:
//   far/mid  → one FULLSCALE state-coloured icon filling the tile (which
//              dimension is in which state, readable from orbit)
//   near     → icon + uppercase label
//   close    → + tool detail + ordinal progress bar
// Used by Grid Board and Inverse Grid; the Hex Puzzle renders the same LOD in
// its hex-shaped cell.
import { useState } from 'react';

import { DimGlyph } from './DimGlyph';
import { DIM_INK, mix, SERIF } from './ink';
import type { DimNode, ZoomBand } from './types';

const COPY = { empty: 'not set up' };

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function DimTile({ node, x, y, w, h, band, highlighted = false, onAction }: {
  node: DimNode;
  x: number;
  y: number;
  w: number;
  h: number;
  band: ZoomBand;
  /** Context-menu hover echo — unmistakably THIS tile. */
  highlighted?: boolean;
  /** Set only when the tile has an Improve action — enables click + hover affordance. */
  onAction?: (e: React.MouseEvent) => void;
}) {
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';
  const zoomedOut = band === 'far' || band === 'mid';
  const big = Math.min(w, h) * 0.62;
  const [hovered, setHovered] = useState(false);
  const lit = highlighted || (hovered && Boolean(onAction));

  return (
    <g
      transform={`translate(${x} ${y})`}
      opacity={absent && !lit ? 0.6 : 1}
      style={onAction ? { cursor: 'pointer' } : undefined}
      onPointerEnter={onAction ? () => setHovered(true) : undefined}
      onPointerLeave={onAction ? () => setHovered(false) : undefined}
      onPointerDown={onAction ? (e) => e.stopPropagation() : undefined}
      onClick={onAction ? (e) => { e.stopPropagation(); onAction(e); } : undefined}
    >
      {/* native tooltip — names the dimension even when zoomed-out LOD hides labels */}
      <title>{`${node.label}${node.detail ? ` — ${node.detail}` : absent ? ' — not set up' : ''}`}</title>
      <rect
        width={w} height={h} rx={8}
        fill={absent ? mix('var(--secondary)', 40, 'var(--background)') : mix(ink, 16, 'var(--background)')}
        stroke={absent ? mix('var(--muted-foreground)', 38) : mix(ink, 50)}
        strokeWidth={1.25} strokeDasharray={absent ? '5 5' : undefined}
      />
      {highlighted && (
        <>
          <rect x={-2.5} y={-2.5} width={w + 5} height={h + 5} rx={10} fill="none" stroke={mix('var(--primary)', 95)} strokeWidth={3} />
          <rect x={-8} y={-8} width={w + 16} height={h + 16} rx={13} fill="none" stroke={mix('var(--primary)', 35)} strokeWidth={2} />
        </>
      )}
      {/* actionable-tile hover affordance — a quiet "this is interactive" ring */}
      {!highlighted && hovered && onAction && (
        <rect x={-2} y={-2} width={w + 4} height={h + 4} rx={9.5} fill="none" stroke={mix('var(--primary)', 70)} strokeWidth={2} />
      )}
      {zoomedOut ? (
        <DimGlyph
          node={node} x={(w - big) / 2} y={(h - big) / 2} size={big} strokeWidth={1.6}
          color={absent ? 'var(--muted-foreground)' : ink}
        />
      ) : (
        <>
          <DimGlyph node={node} x={8} y={8} size={18} strokeWidth={1.75} color={absent ? 'var(--muted-foreground)' : ink} />
          <text x={w - 8} y={21} textAnchor="end" fontSize={11} letterSpacing="0.08em" fontWeight={600} fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 90)} style={{ textTransform: 'uppercase' }}>
            {node.label}
          </text>
          {band === 'close' && (
            <>
              <text x={8} y={h - 18} fontSize={10} fontStyle="italic" fontFamily={SERIF} fill={absent ? mix('var(--muted-foreground)', 85) : mix('var(--foreground)', 68)}>
                {trunc(node.detail ?? (absent ? COPY.empty : ''), Math.floor(w / 6))}
              </text>
              {node.steps > 0 && !absent && (
                <g transform={`translate(8 ${h - 9})`}>
                  <rect y={-1.75} width={w - 16} height={3.5} rx={1.75} fill={mix('var(--foreground)', 10)} />
                  <rect y={-1.75} width={((w - 16) * node.reached) / node.steps} height={3.5} rx={1.75} fill={ink} />
                </g>
              )}
            </>
          )}
        </>
      )}
    </g>
  );
}
