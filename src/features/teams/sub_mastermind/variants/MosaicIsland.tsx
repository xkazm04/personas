// One project as a honeycomb puzzle: core cell + 8 dimension cells snapped
// edge-to-edge on the axial hex lattice. Round-3 LOD (band-driven):
//   far/mid  → FULLSCALE state-coloured icon per cell (dimension states
//              readable from orbit), title large on the banner
//   near     → icon + uppercase label
//   close    → + tool detail + progress
import { memo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { DimGlyph } from '../lib/DimGlyph';
import { DIM_REGISTRY } from '../lib/dimRegistry';
import { DIM_INK, mix, STATE_INK } from '../lib/ink';
import { hexPoints } from '../lib/hex';
import { FleetBadges } from '../lib/FleetBadges';
import { IslandBanner } from '../lib/IslandBanner';
import { mockStats } from '../lib/statsMock';
import { StatColumns } from '../lib/StatColumns';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { IslandCtx } from '../lib/CanvasShell';
import type { DimNode, Island, ZoomBand } from '../lib/types';

const CELL = 56;
// Axial cells: ring-1 six + contiguous ring-2 caps for dimensions 7-12.
// Order matches the dimension registry's DIM_ORDER 1:1 (index N → dimension N).
// LATTICE SLOTS 13+: a 13th dimension needs one more [q,r] axial coord appended
// here (the next free ring-2 cap, e.g. [0,-2] / [0,2]); cells beyond AXIAL.length
// are silently dropped by the render loop's `if (!ax) return null`.
const AXIAL: Array<[number, number]> = [
  [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0],
  [2, -1], [-2, 1], [1, -2], [-1, 2], [2, 0], [-2, 0],
];
const cellXY = (q: number, r: number) => ({ x: CELL * Math.sqrt(3) * (q + r / 2), y: CELL * 1.5 * r });

// React.memo'd: the shell hands it referentially-stable callbacks + primitive
// scalars, so a render-free pan (camera transform only) re-renders zero islands.
// It re-renders only when its own props change — a committed z/band on zoom, a
// mode switch, or its own dim/highlight state.
export const MosaicIsland = memo(function MosaicIsland({ island, z, band, mode, dimmed, onHover, onIslandMove, onIslandCommit, onIslandTap, onConnectStart, onIslandFocus, onIslandMenu, highlightKey, onFleetList, onDimOpen, onPersonasOpen }: { island: Island } & IslandCtx) {
  const { t } = useTranslation();
  const ink = STATE_INK[island.state];
  const drag = useIslandDrag({ enabled: mode === 'edit', z, slug: island.slug, x: island.x, y: island.y, onMove: onIslandMove, onCommit: onIslandCommit, onSelect: onIslandTap });
  // Cluster extents depend on how many cells are occupied — banner, badges,
  // halo, and stat columns track them.
  const pts = AXIAL.slice(0, island.nodes.length).map(([q, r]) => cellXY(q, r));
  const ys = pts.map((p) => p.y);
  const xs = pts.map((p) => p.x);
  const topY = Math.min(0, ...ys) - CELL;
  const botY = Math.max(0, ...ys) + CELL;
  const leftX = Math.min(0, ...xs) - CELL;
  const rightX = Math.max(0, ...xs) + CELL;
  const haloR = Math.max(CELL * 3.1, (botY - topY) / 2 + CELL * 0.8);

  return (
    <g
      transform={`translate(${island.x} ${island.y})`}
      style={{ opacity: dimmed ? 0.3 : 1, transition: 'opacity 200ms ease', cursor: mode === 'connect' ? 'pointer' : undefined }}
      onPointerEnter={() => onHover(island.slug)}
      onPointerLeave={() => onHover(null)}
      onPointerDown={mode === 'connect' ? (e) => onConnectStart(island.slug, e) : undefined}
      onDoubleClick={(e) => { e.stopPropagation(); onIslandFocus(island.slug); }}
      data-testid={`mm-island-${island.slug}`}
    >
      {/* state halo behind the honeycomb — keeps the island recognizable when tiny */}
      <circle r={haloR} fill={mix(ink, 10, 'var(--secondary)')} opacity={0.5} filter="url(#mm-coast)" />

      {island.nodes.map((n, k) => {
        const ax = AXIAL[k];
        if (!ax) return null;
        const p = cellXY(ax[0], ax[1]);
        return (
          <MosaicCell
            key={n.key}
            node={n}
            x={p.x}
            y={p.y}
            band={band}
            highlighted={highlightKey === n.key}
            onAction={n.action ? (e) => onDimOpen(island.slug, n, e) : undefined}
          />
        );
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
          {t.mastermind.score_legend}
        </text>
      )}

      <IslandBanner
        island={island}
        z={z}
        band={band}
        topWorldY={topY - 10}
        handleProps={mode === 'edit' ? { handlers: { ...drag }, cursor: 'move' } : undefined}
        onContextMenu={(e) => onIslandMenu(island.slug, e)}
      />
      {band !== 'far' && <StatColumns stats={mockStats(island.slug)} z={z} leftX={leftX} rightX={rightX} />}
      <FleetBadges
        fleet={island.fleet}
        personas={island.personasRunning}
        z={z}
        yWorld={botY + 12}
        onOpenList={(state, e) => onFleetList(island.slug, state, e)}
        onOpenPersonas={(e) => onPersonasOpen(island.slug, e)}
      />
    </g>
  );
});

function MosaicCell({ node, x, y, band, highlighted, onAction }: {
  node: DimNode;
  x: number;
  y: number;
  band: ZoomBand;
  highlighted: boolean;
  /** Set only when the cell has an Improve action — enables click + hover affordance. */
  onAction?: (e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';
  const zoomedOut = band === 'far' || band === 'mid';
  const [hovered, setHovered] = useState(false);
  const lit = highlighted || (hovered && Boolean(onAction));

  return (
    <g
      transform={`translate(${x} ${y})`}
      className={node.busy ? 'animate-pulse' : undefined}
      opacity={absent && !lit ? 0.6 : 1}
      style={onAction ? { cursor: 'pointer' } : undefined}
      onPointerEnter={onAction ? () => setHovered(true) : undefined}
      onPointerLeave={onAction ? () => setHovered(false) : undefined}
      onPointerDown={onAction ? (e) => e.stopPropagation() : undefined}
      onClick={onAction ? (e) => { e.stopPropagation(); onAction(e); } : undefined}
    >
      {/* native tooltip — names the dimension even when zoomed-out LOD hides labels */}
      <title>{`${node.label}${node.detail ? ` — ${node.detail}` : absent ? ` — ${t.mastermind.cell_empty}` : ''}`}</title>
      <polygon
        points={hexPoints(0, 0, CELL - 1.5)}
        fill={absent ? mix('var(--secondary)', 45, 'var(--background)') : mix(ink, 20, 'var(--secondary)')}
        stroke={absent ? mix('var(--muted-foreground)', 40) : mix(ink, 55)}
        strokeWidth={1.5} strokeDasharray={absent ? '5 5' : undefined} strokeLinejoin="round"
      />
      {/* context-menu hover echo — unmistakably THIS cell */}
      {highlighted && (
        <>
          <polygon points={hexPoints(0, 0, CELL + 2)} fill="none" stroke={mix('var(--primary)', 95)} strokeWidth={3.5} strokeLinejoin="round" />
          <polygon points={hexPoints(0, 0, CELL + 9)} fill="none" stroke={mix('var(--primary)', 35)} strokeWidth={2} strokeLinejoin="round" />
        </>
      )}
      {/* actionable-cell hover affordance — a quiet "this is interactive" ring */}
      {!highlighted && hovered && onAction && (
        <polygon points={hexPoints(0, 0, CELL + 1)} fill="none" stroke={mix('var(--primary)', 70)} strokeWidth={2} strokeLinejoin="round" />
      )}
      {zoomedOut ? (
        DIM_REGISTRY[node.key]?.payloadKind === 'days' && node.days != null ? (
          // days-payload cell: the count IS the payload when zoomed out (Ideas' freshness)
          <>
            <DimGlyph node={node} x={-8} y={-34} size={16} strokeWidth={1.75} color={ink} />
            <text y={18} textAnchor="middle" fontSize={30} fontWeight={700} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {node.days}d
            </text>
          </>
        ) : (
          // fullscale icon — the cell IS the icon when zoomed out
          <DimGlyph node={node} x={-27} y={-27} size={54} strokeWidth={1.5} color={absent ? 'var(--muted-foreground)' : ink} />
        )
      ) : (
        <>
          <DimGlyph node={node} x={-11} y={-30} size={22} strokeWidth={1.75} color={absent ? 'var(--muted-foreground)' : ink} />
          <text y={8} textAnchor="middle" fontSize={12} letterSpacing="0.08em" fontWeight={600} fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 90)} style={{ textTransform: 'uppercase' }}>
            {node.label}
          </text>
          {band === 'close' && (
            <>
              <text y={24} textAnchor="middle" fontSize={9.5} fontStyle="italic" fill={absent ? mix('var(--muted-foreground)', 85) : mix('var(--foreground)', 65)}>
                {node.detail ?? (absent ? t.mastermind.cell_empty : '')}
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
