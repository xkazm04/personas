// One project as an INVERSE grid: the core sits in the CENTER cell and the
// dimension tiles form a layer around it (3×3; a second layer would open for
// overflow dimensions). Same band LOD as the other variants — fullscale icons
// at far/mid, labels at near, details at close; identity on the banner.
import { DimTile } from '../lib/DimTile';
import { FLEET_INK, mix, scoreInkVar, STATE_INK } from '../lib/ink';
import { animalIcon } from '../lib/fleetMeta';
import { FleetBadges } from '../lib/FleetBadges';
import { IslandBanner } from '../lib/IslandBanner';
import { mockStats } from '../lib/statsMock';
import { StatColumns } from '../lib/StatColumns';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { IslandCtx } from '../lib/CanvasShell';
import type { FleetNode, Island, ZoomBand } from '../lib/types';
import { bandGte } from '../lib/types';

const CW = 104;
const CH = 92;
const GAP = 8;
// Layer-1 cells clockwise from north (N, NE, E, SE, S, SW, W, NW), then
// layer-2 opens along the top row for dimensions 9-11, then FREE SLOTS the
// Cells fleet treatment fills dynamically — one tile per terminal session.
const RING: Array<[number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  [0, -2], [1, -2], [-1, -2],
  [2, -2], [-2, -2], [2, -1], [-2, -1], [2, 0], [-2, 0], [2, 1],
];

export function InverseIsland({ island, z, band, mode, dimmed, onHover, onIslandMove, onIslandCommit, onFleetOpen, onIslandTap, onConnectStart, onIslandFocus, onIslandMenu, highlightKey, statsStyle, fleetStyle, onFleetList }: { island: Island } & IslandCtx) {
  const ink = STATE_INK[island.state];
  const drag = useIslandDrag({ enabled: mode === 'edit', z, slug: island.slug, x: island.x, y: island.y, onMove: onIslandMove, onCommit: onIslandCommit, onSelect: onIslandTap });
  const zoomedIn = bandGte(band, 'near');
  // Cells treatment: sessions occupy the free grid slots after the dims.
  const fleetCells = fleetStyle === 'cells'
    ? island.fleet.slice(0, Math.max(0, RING.length - island.nodes.length))
    : [];
  // Formation extents grow with layer 2 + fleet cells — halo, banner, badges track them.
  const used = RING.slice(0, island.nodes.length + fleetCells.length);
  const rows = used.map(([, r]) => r);
  const cols = used.map(([c]) => c);
  const topY = (Math.min(0, ...rows)) * (CH + GAP) - CH / 2;
  const botY = (Math.max(0, ...rows)) * (CH + GAP) + CH / 2;
  const leftX = (Math.min(-1, ...cols)) * (CW + GAP) - CW / 2 - 10;
  const rightX = (Math.max(1, ...cols)) * (CW + GAP) + CW / 2 + 10;

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
      <rect
        x={leftX - 2} y={topY - 12}
        width={rightX - leftX + 4} height={botY - topY + 24}
        rx={26} fill={mix(ink, 9, 'var(--secondary)')} opacity={0.55} filter="url(#mm-coast)"
      />

      {island.nodes.map((n, k) => {
        const cell = RING[k];
        if (!cell) return null;
        const tx = cell[0] * (CW + GAP) - CW / 2;
        const ty = cell[1] * (CH + GAP) - CH / 2;
        return <DimTile key={n.key} node={n} x={tx} y={ty} w={CW} h={CH} band={band} highlighted={highlightKey === n.key} />;
      })}
      {fleetCells.map((f, k) => {
        const cell = RING[island.nodes.length + k];
        if (!cell) return null;
        const tx = cell[0] * (CW + GAP) - CW / 2;
        const ty = cell[1] * (CH + GAP) - CH / 2;
        return <FleetTileCell key={f.id} node={f} x={tx} y={ty} band={band} onOpen={onFleetOpen} />;
      })}

      {/* core — the center cell */}
      <rect x={-CW / 2} y={-CH / 2} width={CW} height={CH} rx={12} fill={mix(ink, 22, 'var(--secondary)')} stroke={mix(ink, 75)} strokeWidth={2} />
      {zoomedIn ? (
        <g>
          <text y={-8} textAnchor="middle" fontSize={17} fontWeight={700} fill={scoreInkVar(island.autoScore)} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {island.autoScore}
          </text>
          <text y={14} textAnchor="middle" fontSize={17} fontWeight={700} fill={scoreInkVar(island.prodScore)} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {island.prodScore}
          </text>
          {band === 'close' && (
            <text y={30} textAnchor="middle" fontSize={7.5} letterSpacing="0.16em" fill={mix('var(--foreground)', 55)} style={{ textTransform: 'uppercase' }}>
              auto · prod
            </text>
          )}
          {island.blockers > 0 && (
            <g transform={`translate(${CW / 2 - 12} ${-CH / 2 + 12})`}>
              <circle r={10} fill={mix('var(--status-error)', 18, 'var(--background)')} stroke={mix('var(--status-error)', 70)} strokeWidth={1.5} />
              <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--status-error)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {island.blockers}
              </text>
            </g>
          )}
        </g>
      ) : (
        <circle r={Math.min(CW, CH) * 0.24} fill="none" stroke={mix(ink, 85)} strokeWidth={6} />
      )}

      <IslandBanner
        island={island}
        z={z}
        band={band}
        topWorldY={topY - 14}
        handleProps={mode === 'edit' ? { handlers: { ...drag }, cursor: 'move' } : undefined}
        onContextMenu={(e) => onIslandMenu(island.slug, e)}
      />
      {statsStyle === 'columns' && band !== 'far' && (
        <StatColumns stats={mockStats(island.slug)} z={z} leftX={leftX} rightX={rightX} />
      )}
      {fleetStyle === 'badges' && (
        <FleetBadges fleet={island.fleet} z={z} yWorld={botY + 14} onOpenList={(state, e) => onFleetList(island.slug, state, e)} />
      )}
    </g>
  );
}

/** A terminal session as a first-class grid tile (Cells treatment): state ink
 *  + the session's animal glyph; click opens the terminal preview. */
function FleetTileCell({ node, x, y, band, onOpen }: { node: FleetNode; x: number; y: number; band: ZoomBand; onOpen: (id: string) => void }) {
  const ink = FLEET_INK[node.state] ?? 'var(--status-neutral)';
  const Animal = animalIcon(node.id);
  const zoomedOut = band === 'far' || band === 'mid';
  const big = Math.min(CW, CH) * 0.58;
  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onOpen(node.id); }}
      data-testid={`mm-fleet-cell-${node.id}`}
    >
      <title>{`${node.label} — ${node.state.replace('_', ' ')}`}</title>
      <rect width={CW} height={CH} rx={10} fill={mix(ink, 20, 'var(--secondary)')} stroke={mix(ink, 70)} strokeWidth={1.75} />
      {zoomedOut ? (
        <Animal x={(CW - big) / 2} y={(CH - big) / 2} width={big} height={big} strokeWidth={1.5} style={{ color: ink }} />
      ) : (
        <>
          <Animal x={8} y={8} width={20} height={20} strokeWidth={1.75} style={{ color: ink }} />
          <text x={CW / 2} y={CH - 30} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={mix('var(--foreground)', 92)}>
            {node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label}
          </text>
          <text x={CW / 2} y={CH - 14} textAnchor="middle" fontSize={8} letterSpacing="0.1em" fill={ink} style={{ textTransform: 'uppercase' }}>
            {node.state.replace('_', ' ')}
          </text>
        </>
      )}
    </g>
  );
}
