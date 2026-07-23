// One project as an INVERSE grid: the core sits in the CENTER cell and the
// dimension tiles form a layer around it (3×3; a second layer would open for
// overflow dimensions). Same band LOD as the other variants — fullscale icons
// at far/mid, labels at near, details at close; identity on the banner.
import { memo, useRef } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { DimTile } from '../lib/DimTile';
import { mix, scoreInkVar, STATE_INK } from '../lib/ink';
import { FleetBadges } from '../lib/FleetBadges';
import { IslandBanner } from '../lib/IslandBanner';
import { StatColumns } from '../lib/StatColumns';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { IslandCtx } from '../lib/CanvasShell';
import type { Island } from '../lib/types';
import { bandGte } from '../lib/types';

const CW = 104;
const CH = 92;
const GAP = 8;
// Layer-1 cells clockwise from north (N, NE, E, SE, S, SW, W, NW), then
// layer-2 opens along the top row for dimensions 9-12 — the "layers around
// the core" growth direction. Order matches the dimension registry's DIM_ORDER
// 1:1 (index N → dimension N).
// LATTICE SLOTS 13+: a 13th dimension needs one more [col,row] coord appended
// here (continue layer-2, e.g. [2,-1] / [-2,-2]); cells beyond RING.length are
// silently dropped by the render loop's `if (!cell) return null`.
const RING: Array<[number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
  [0, -2], [1, -2], [-1, -2], [2, -2], [-2, -2],
];

// React.memo'd — see MosaicIsland for the render-free-navigation rationale.
export const InverseIsland = memo(function InverseIsland({ island, z, band, mode, onHover, onIslandCommit, onIslandTap, onConnectStart, onIslandFocus, onIslandMenu, highlightKey, onFleetList, onDimOpen, onPersonasOpen }: { island: Island } & IslandCtx) {
  const { t } = useTranslation();
  const ink = STATE_INK[island.state];
  const rootRef = useRef<SVGGElement>(null);
  const drag = useIslandDrag({ enabled: mode === 'edit', z, slug: island.slug, x: island.x, y: island.y, rootRef, onCommit: onIslandCommit, onSelect: onIslandTap });
  const zoomedIn = bandGte(band, 'near');
  // Formation extents grow with layer 2 — halo, banner, badges track them.
  const used = RING.slice(0, island.nodes.length);
  const rows = used.map(([, r]) => r);
  const cols = used.map(([c]) => c);
  const topY = (Math.min(0, ...rows)) * (CH + GAP) - CH / 2;
  const botY = (Math.max(0, ...rows)) * (CH + GAP) + CH / 2;
  const leftX = (Math.min(-1, ...cols)) * (CW + GAP) - CW / 2 - 10;
  const rightX = (Math.max(1, ...cols)) * (CW + GAP) + CW / 2 + 10;

  return (
    <g
      ref={rootRef}
      data-mm-island={island.slug}
      transform={`translate(${island.x} ${island.y})`}
      style={{ transition: 'opacity 200ms ease', cursor: mode === 'connect' ? 'pointer' : undefined }}
      onPointerEnter={() => onHover(island.slug)}
      onPointerLeave={() => onHover(null)}
      onPointerDown={mode === 'connect' ? (e) => onConnectStart(island.slug, e) : undefined}
      onDoubleClick={(e) => { e.stopPropagation(); onIslandFocus(island.slug); }}
      data-testid={`mm-island-${island.slug}`}
    >
      {/* two-layer plate replaces the old Gaussian-blurred halo: an outer,
          fainter rounded rect fakes the soft coast without any per-island
          filter rasterization during zoom. */}
      <rect
        x={leftX - 16} y={topY - 26}
        width={rightX - leftX + 32} height={botY - topY + 52}
        rx={38} fill={mix(ink, 9, 'var(--secondary)')} opacity={0.22}
      />
      <rect
        x={leftX - 2} y={topY - 12}
        width={rightX - leftX + 4} height={botY - topY + 24}
        rx={26} fill={mix(ink, 9, 'var(--secondary)')} opacity={0.55}
      />

      {island.nodes.map((n, k) => {
        const cell = RING[k];
        if (!cell) return null;
        const tx = cell[0] * (CW + GAP) - CW / 2;
        const ty = cell[1] * (CH + GAP) - CH / 2;
        return (
          <DimTile
            key={n.key}
            node={n}
            x={tx}
            y={ty}
            w={CW}
            h={CH}
            band={band}
            highlighted={highlightKey === n.key}
            onAction={n.action ? (e) => onDimOpen(island.slug, n, e) : undefined}
          />
        );
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
              {t.mastermind.score_legend}
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
      {band !== 'far' && (
        <StatColumns stats={island.stats} z={z} leftX={leftX} rightX={rightX} />
      )}
      <FleetBadges
        fleet={island.fleet}
        personas={island.personasRunning}
        z={z}
        yWorld={botY + 14}
        onOpenList={(state, e) => onFleetList(island.slug, state, e)}
        onOpenPersonas={(e) => onPersonasOpen(island.slug, e)}
      />
    </g>
  );
});
