// Shared rectangular dimension tile with band-driven level of detail:
//   far/mid  → one FULLSCALE state-coloured icon filling the tile (which
//              dimension is in which state, readable from orbit)
//   near     → icon + uppercase label
//   close    → + tool detail + ordinal progress bar
// Used by Grid Board and Inverse Grid; the Hex Puzzle renders the same LOD in
// its hex-shaped cell.
import { DIM_ICON } from './dimMeta';
import { DIM_INK, mix, SERIF } from './ink';
import type { DimNode, ZoomBand } from './types';

const COPY = { empty: 'not set up' };

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function DimTile({ node, x, y, w, h, band }: {
  node: DimNode;
  x: number;
  y: number;
  w: number;
  h: number;
  band: ZoomBand;
}) {
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';
  const Icon = DIM_ICON[node.key];
  const zoomedOut = band === 'far' || band === 'mid';
  const big = Math.min(w, h) * 0.62;

  return (
    <g transform={`translate(${x} ${y})`} opacity={absent ? 0.6 : 1}>
      <rect
        width={w} height={h} rx={8}
        fill={absent ? mix('var(--secondary)', 40, 'var(--background)') : mix(ink, 16, 'var(--background)')}
        stroke={absent ? mix('var(--muted-foreground)', 38) : mix(ink, 50)}
        strokeWidth={1.25} strokeDasharray={absent ? '5 5' : undefined}
      />
      {zoomedOut ? (
        <Icon
          x={(w - big) / 2} y={(h - big) / 2} width={big} height={big} strokeWidth={1.6}
          style={{ color: absent ? 'var(--muted-foreground)' : ink }}
        />
      ) : (
        <>
          <Icon x={8} y={8} width={18} height={18} strokeWidth={1.75} style={{ color: absent ? 'var(--muted-foreground)' : ink }} />
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
