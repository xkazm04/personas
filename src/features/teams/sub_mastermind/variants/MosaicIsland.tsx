// One project as a honeycomb puzzle: core cell + 8 dimension cells snapped
// edge-to-edge on the axial hex lattice (true tessellation — cells interlock
// like puzzle pieces). Identity lives on the counter-scaled banner (always
// legible); in-cell text is legibility-gated so no zoom level shows mush —
// zoomed out, the cluster reads as a coloured mosaic silhouette.
import { DIM_ICON } from '../lib/dimMeta';
import { DIM_INK, mix, STATE_INK } from '../lib/ink';
import { hexPoints } from '../lib/hex';
import { IslandBanner } from '../lib/IslandBanner';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { CanvasMode, DimNode, Island } from '../lib/types';

const CELL = 56;
// Axial cells: ring-1 six + two ring-2 caps (contiguous with the ring) for the
// 7th/8th dimension. Order matches deriveScene's node order.
const AXIAL: Array<[number, number]> = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [2, -1], [-2, 1]];
const cellXY = (q: number, r: number) => ({ x: CELL * Math.sqrt(3) * (q + r / 2), y: CELL * 1.5 * r });

const COPY = { empty: 'not set up' };

export function MosaicIsland({ island, z, mode, dimmed, onHover, onIslandMove, onIslandCommit }: {
  island: Island;
  z: number;
  mode: CanvasMode;
  dimmed: boolean;
  onHover: (slug: string | null) => void;
  onIslandMove: (slug: string, x: number, y: number) => void;
  onIslandCommit: (slug: string, x: number, y: number) => void;
}) {
  const ink = STATE_INK[island.state];
  const drag = useIslandDrag({ enabled: mode === 'edit', z, slug: island.slug, x: island.x, y: island.y, onMove: onIslandMove, onCommit: onIslandCommit });

  return (
    <g
      transform={`translate(${island.x} ${island.y})`}
      style={{ opacity: dimmed ? 0.3 : 1, transition: 'opacity 200ms ease', cursor: mode === 'edit' ? 'move' : undefined }}
      onPointerEnter={() => onHover(island.slug)}
      onPointerLeave={() => onHover(null)}
      {...drag}
      data-testid={`mm-island-${island.slug}`}
    >
      {/* state halo behind the honeycomb — keeps the island recognizable when tiny */}
      <circle r={CELL * 3.1} fill={mix(ink, 10, 'var(--secondary)')} opacity={0.5} filter="url(#mm-coast)" />

      {island.nodes.map((n, k) => {
        const ax = AXIAL[k];
        if (!ax) return null;
        const p = cellXY(ax[0], ax[1]);
        return <MosaicCell key={n.key} node={n} x={p.x} y={p.y} z={z} />;
      })}

      {/* core cell */}
      <polygon points={hexPoints(0, 0, CELL - 1.5)} fill={mix(ink, 26, 'var(--secondary)')} stroke={mix(ink, 70)} strokeWidth={2} strokeLinejoin="round" />
      {z >= 0.55 && (
        <text y={5} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {island.autoScore}·{island.prodScore}
        </text>
      )}
      {z >= 0.9 && (
        <text y={21} textAnchor="middle" fontSize={7} letterSpacing="0.16em" fill={mix('var(--foreground)', 55)} style={{ textTransform: 'uppercase' }}>
          auto·prod
        </text>
      )}

      <IslandBanner island={island} z={z} topWorldY={-CELL * 2.6} />
    </g>
  );
}

function MosaicCell({ node, x, y, z }: { node: DimNode; x: number; y: number; z: number }) {
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';
  const Icon = DIM_ICON[node.key];
  // Legibility gates: an element renders only when it would be ≥ ~9 screen px.
  const showIcon = z >= 0.45;
  const showLabel = z >= 0.8;
  const showDetail = z >= 1.05;

  return (
    <g transform={`translate(${x} ${y})`} opacity={absent ? 0.6 : 1}>
      <polygon
        points={hexPoints(0, 0, CELL - 1.5)}
        fill={absent ? mix('var(--secondary)', 45, 'var(--background)') : mix(ink, 20, 'var(--secondary)')}
        stroke={absent ? mix('var(--muted-foreground)', 40) : mix(ink, 55)}
        strokeWidth={1.5} strokeDasharray={absent ? '5 5' : undefined} strokeLinejoin="round"
      />
      {showIcon && (
        <Icon
          x={-10} y={showLabel ? -26 : -10} width={20} height={20} strokeWidth={1.75}
          style={{ color: absent ? 'var(--muted-foreground)' : ink }}
        />
      )}
      {showLabel && (
        <text y={8} textAnchor="middle" fontSize={9.5} letterSpacing="0.1em" fontWeight={600} fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 90)} style={{ textTransform: 'uppercase' }}>
          {node.label}
        </text>
      )}
      {showDetail && (
        <text y={24} textAnchor="middle" fontSize={9} fontStyle="italic" fill={absent ? mix('var(--muted-foreground)', 85) : mix('var(--foreground)', 65)}>
          {node.detail ?? (absent ? COPY.empty : '')}
        </text>
      )}
      {showDetail && node.steps > 0 && !absent && (
        <g transform="translate(0 33)">
          <rect x={-20} y={-2} width={40} height={3.5} rx={1.75} fill={mix('var(--foreground)', 10)} />
          <rect x={-20} y={-2} width={(40 * node.reached) / node.steps} height={3.5} rx={1.75} fill={ink} />
        </g>
      )}
    </g>
  );
}
