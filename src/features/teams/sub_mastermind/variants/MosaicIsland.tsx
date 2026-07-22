// One project as a honeycomb puzzle: core cell + 8 dimension cells snapped
// edge-to-edge on the axial hex lattice. Round-3 LOD (band-driven):
//   far/mid  → FULLSCALE state-coloured icon per cell (dimension states
//              readable from orbit), title large on the banner
//   near     → icon + uppercase label
//   close    → + tool detail + progress
import { DIM_ICON } from '../lib/dimMeta';
import { DIM_INK, mix, STATE_INK } from '../lib/ink';
import { hexPoints } from '../lib/hex';
import { FleetDock } from '../lib/FleetDock';
import { IslandBanner } from '../lib/IslandBanner';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { IslandCtx } from '../lib/CanvasShell';
import type { DimNode, Island, ZoomBand } from '../lib/types';

const CELL = 56;
// Axial cells: ring-1 six + contiguous ring-2 caps for dimensions 7-11.
// Order matches deriveScene's node order; every cap shares an edge with the
// ring so the puzzle stays interlocked.
const AXIAL: Array<[number, number]> = [
  [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0],
  [2, -1], [-2, 1], [1, -2], [-1, 2], [2, 0],
];
const cellXY = (q: number, r: number) => ({ x: CELL * Math.sqrt(3) * (q + r / 2), y: CELL * 1.5 * r });

const COPY = { empty: 'not set up' };

export function MosaicIsland({ island, z, band, mode, dimmed, onHover, onIslandMove, onIslandCommit, onFleetOpen }: { island: Island } & IslandCtx) {
  const ink = STATE_INK[island.state];
  const drag = useIslandDrag({ enabled: mode === 'edit', z, slug: island.slug, x: island.x, y: island.y, onMove: onIslandMove, onCommit: onIslandCommit });
  // Cluster extents depend on how many cells are occupied (8 dims stay within
  // r=±1 caps; 11 reach r=±2) — banner, dock, and halo track them.
  const ys = AXIAL.slice(0, island.nodes.length).map(([q, r]) => cellXY(q, r).y);
  const topY = Math.min(0, ...ys) - CELL;
  const botY = Math.max(0, ...ys) + CELL;
  const haloR = Math.max(CELL * 3.1, (botY - topY) / 2 + CELL * 0.8);

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
      <circle r={haloR} fill={mix(ink, 10, 'var(--secondary)')} opacity={0.5} filter="url(#mm-coast)" />

      {island.nodes.map((n, k) => {
        const ax = AXIAL[k];
        if (!ax) return null;
        const p = cellXY(ax[0], ax[1]);
        return <MosaicCell key={n.key} node={n} x={p.x} y={p.y} band={band} />;
      })}

      {/* core cell */}
      <polygon points={hexPoints(0, 0, CELL - 1.5)} fill={mix(ink, 26, 'var(--secondary)')} stroke={mix(ink, 70)} strokeWidth={2} strokeLinejoin="round" />
      {(band === 'far' || band === 'mid') && (
        <circle r={CELL * 0.32} fill="none" stroke={mix(ink, 85)} strokeWidth={5} />
      )}
      {(band === 'near' || band === 'close') && (
        <text y={5} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {island.autoScore}·{island.prodScore}
        </text>
      )}
      {band === 'close' && (
        <text y={21} textAnchor="middle" fontSize={7} letterSpacing="0.16em" fill={mix('var(--foreground)', 55)} style={{ textTransform: 'uppercase' }}>
          auto·prod
        </text>
      )}

      <IslandBanner island={island} z={z} band={band} topWorldY={topY - 10} />
      <FleetDock fleet={island.fleet} z={z} yWorld={botY + 14} onOpen={onFleetOpen} />
    </g>
  );
}

function MosaicCell({ node, x, y, band }: { node: DimNode; x: number; y: number; band: ZoomBand }) {
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';
  const Icon = DIM_ICON[node.key];
  const zoomedOut = band === 'far' || band === 'mid';

  return (
    <g transform={`translate(${x} ${y})`} opacity={absent ? 0.6 : 1}>
      <polygon
        points={hexPoints(0, 0, CELL - 1.5)}
        fill={absent ? mix('var(--secondary)', 45, 'var(--background)') : mix(ink, 20, 'var(--secondary)')}
        stroke={absent ? mix('var(--muted-foreground)', 40) : mix(ink, 55)}
        strokeWidth={1.5} strokeDasharray={absent ? '5 5' : undefined} strokeLinejoin="round"
      />
      {zoomedOut ? (
        // fullscale icon — the cell IS the icon when zoomed out
        <Icon x={-27} y={-27} width={54} height={54} strokeWidth={1.5} style={{ color: absent ? 'var(--muted-foreground)' : ink }} />
      ) : (
        <>
          <Icon x={-11} y={-30} width={22} height={22} strokeWidth={1.75} style={{ color: absent ? 'var(--muted-foreground)' : ink }} />
          <text y={8} textAnchor="middle" fontSize={12} letterSpacing="0.08em" fontWeight={600} fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 90)} style={{ textTransform: 'uppercase' }}>
            {node.label}
          </text>
          {band === 'close' && (
            <>
              <text y={24} textAnchor="middle" fontSize={9.5} fontStyle="italic" fill={absent ? mix('var(--muted-foreground)', 85) : mix('var(--foreground)', 65)}>
                {node.detail ?? (absent ? COPY.empty : '')}
              </text>
              {node.steps > 0 && !absent && (
                <g transform="translate(0 34)">
                  <rect x={-20} y={-2} width={40} height={3.5} rx={1.75} fill={mix('var(--foreground)', 10)} />
                  <rect x={-20} y={-2} width={(40 * node.reached) / node.steps} height={3.5} rx={1.75} fill={ink} />
                </g>
              )}
            </>
          )}
        </>
      )}
    </g>
  );
}
