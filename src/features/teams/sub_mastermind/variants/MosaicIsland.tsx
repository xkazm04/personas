// One project as a honeycomb puzzle: core cell + dimension cells snapped
// edge-to-edge on the axial hex lattice. LOD is band-driven:
//   far      → ONE large hex: the live-process count, or a sleeping mark when
//              nothing is running, with the process breakdown on its border
//              (see FarProcessHex). At portfolio distance the question is
//              "where is work happening", not "how is this project wired".
//   mid      → FOUR category hexes (runtime/delivery/agentic/product), each a
//              fullscale icon in its rolled-up status colour — 15 same-sized
//              dots is not a shape you can read from orbit
//   near     → the full lattice explodes back: full-hex watermark icon with the
//              STATE VALUE (progress / days / status mark) as the foreground
//   close    → inspection detail: small icon + label + tool detail + progress
// The cluster's extents are always measured from the FULL lattice, so the
// halo, banner, stat columns and fleet badges never move across a band change —
// only the cells inside swap.
import { memo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { DimGlyph } from '../lib/DimGlyph';
import { FarProcessHex } from '../lib/FarProcessHex';
import { MidFacetCube } from '../lib/MidFacetCube';
import { MidTallyBoard } from '../lib/MidTallyBoard';
import { useMidVariant } from '../lib/midVariantStore';
import { CATEGORY_ICON, categoryNodes, type CategoryNode } from '../lib/dimCategories';
import { cellHint } from '../lib/dimMeta';
import { DIM_REGISTRY } from '../lib/dimRegistry';
import { DIM_INK, mix, STATE_INK } from '../lib/ink';
import { hexPoints } from '../lib/hex';
import { FleetBadges } from '../lib/FleetBadges';
import { IslandBanner } from '../lib/IslandBanner';
import { StatColumns } from '../lib/StatColumns';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { IslandCtx } from '../lib/CanvasShell';
import type { DimNode, Island, ZoomBand } from '../lib/types';

const CELL = 56;

/** Near-band state value — the reading that replaces the old small icon:
 *  ordinal progress ("2/4"), numeric payload ("12d" freshness, goal count), or
 *  a status mark for boolean dimensions. ASCII-safe marks; colour carries the
 *  severity, the mark carries the shape. */
const STATUS_MARK: Record<DimNode['status'], string> = {
  solid: '✓', partial: '~', risk: '!', alert: '!!', absent: '–', unknown: '?',
};
const cellValue = (node: DimNode): string => {
  const kind = DIM_REGISTRY[node.key]?.payloadKind;
  if (kind !== 'icon' && node.days != null) return `${node.days}${kind === 'days' ? 'd' : ''}`;
  if (node.steps > 0 && node.status !== 'absent') return `${node.reached}/${node.steps}`;
  return STATUS_MARK[node.status];
};
// Axial cells: ring-1 six + contiguous ring-2 caps for dimensions 7-12.
// Order matches the dimension registry's DIM_ORDER 1:1 (index N → dimension N).
// LATTICE SLOTS 16+: a 16th dimension needs one more [q,r] axial coord appended
// here (the next free ring-2 cells, e.g. [2,-2] / [1,1]); cells beyond AXIAL.length
// are silently dropped by the render loop's `if (!ax) return null`.
const AXIAL: Array<[number, number]> = [
  [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0],
  [2, -1], [-2, 1], [1, -2], [-1, 2], [2, 0], [-2, 0],
  [0, -2], // slot 13 (goals) — top ring-2 cap
  [0, 2], [-2, 2], // slots 14-15 (datalinks, support) — the next free ring-2 caps
];
const cellXY = (q: number, r: number) => ({ x: CELL * Math.sqrt(3) * (q + r / 2), y: CELL * 1.5 * r });

// Zoomed-out lattice: four oversized hexes in a symmetric quad around the core
// (NW, NE, SE, SW), pushed out and grown so the collapsed body still fills a
// comparable footprint. Index maps onto CATEGORY_ORDER.
const CAT_RADIUS = CELL * 1.28;
const CAT_SPREAD = 1.62;
const CAT_AXIAL: Array<[number, number]> = [[0, -1], [1, -1], [0, 1], [-1, 1]];
const catXY = (q: number, r: number) => {
  const p = cellXY(q, r);
  return { x: p.x * CAT_SPREAD, y: p.y * CAT_SPREAD };
};

// React.memo'd: the shell hands it referentially-stable callbacks + primitive
// scalars, so a render-free pan (camera transform only) re-renders zero islands.
// It re-renders only when its own props change — a committed z/band on zoom, a
// mode switch, or its own dim/highlight state.
export const MosaicIsland = memo(function MosaicIsland({ island, z, band, mode, onHover, onIslandCommit, onIslandTap, onShipOpen, onConnectStart, onIslandFocus, onIslandMenu, highlightKey, onFleetList, onDimOpen, onPersonasOpen, onCategoryOpen }: { island: Island } & IslandCtx) {
  const { t } = useTranslation();
  const ink = STATE_INK[island.state];
  const rootRef = useRef<SVGGElement>(null);
  const drag = useIslandDrag({ enabled: mode === 'edit', z, slug: island.slug, x: island.x, y: island.y, rootRef, onCommit: onIslandCommit, onSelect: onIslandTap });
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
  // `far` is now its own body (one process hex); `mid` is the band that
  // collapses to four category cells, with the context menu's hover echo
  // following onto the category that owns the hovered dimension.
  const far = band === 'far';
  // PROTOTYPE (mid A/B): `collapsed` is now the BASELINE mid body — the two
  // candidate variants render instead when selected. Consolidation deletes the
  // switcher and whichever two of the three lose.
  const midVariant = useMidVariant();
  const mid = band === 'mid';
  const collapsed = mid && midVariant === 'baseline';
  const categories = collapsed ? categoryNodes(island.nodes) : [];
  const categoryOfHighlight = highlightKey ? DIM_REGISTRY[highlightKey as keyof typeof DIM_REGISTRY]?.category : undefined;
  // Demo islands carry no passport, so every cell resolves to no action and
  // refuses clicks in silence. The tooltip says why rather than reading broken.
  const isDemo = island.slug.startsWith('demo-');

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
      {/* state halo behind the honeycomb — keeps the island recognizable when
          tiny. A shared per-state radial gradient replaces the old Gaussian
          filter: visually the same soft coast, none of the per-island blur
          rasterization cost during zoom. */}
      <circle r={haloR * 1.18} fill={`url(#mm-halo-${island.state})`} opacity={0.5} />

      {far ? (
        <FarProcessHex fleet={island.fleet} personas={island.personasRunning} runners={island.runners} attention={island.attention} />
      ) : mid && midVariant === 'facet' ? (
        <MidFacetCube fleet={island.fleet} personas={island.personasRunning} runners={island.runners} />
      ) : mid && midVariant === 'tally' ? (
        <MidTallyBoard fleet={island.fleet} personas={island.personasRunning} runners={island.runners} />
      ) : collapsed
        ? categories.map((c, k) => {
          const ax = CAT_AXIAL[k];
          if (!ax) return null;
          const p = catXY(ax[0], ax[1]);
          // Click opens the category's dimension list; double-click frames the
          // island — the drill-in gesture that explodes it back into real cells.
          return (
            <CategoryCell
              key={c.key}
              category={c}
              x={p.x}
              y={p.y}
              highlighted={categoryOfHighlight === c.key}
              onOpen={mode === 'edit' ? (e) => onCategoryOpen(island.slug, c, e) : undefined}
              onDrillIn={mode === 'edit' ? () => onIslandFocus(island.slug) : undefined}
            />
          );
        })
        : island.nodes.map((n, k) => {
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
              hint={cellHint(n.key, isDemo, t)}
              onAction={n.action ? (e) => onDimOpen(island.slug, n, e) : undefined}
            />
          );
        })}

      {/* Core cell. Suppressed at `far`: the process hex IS the body there, and
          a second hex sitting inside it would read as a target, not a project. */}
      {!far && !(mid && midVariant !== 'baseline') && (
        <polygon points={hexPoints(0, 0, CELL - 1.5)} fill={mix(ink, 26, 'var(--secondary)')} stroke={mix(ink, 70)} strokeWidth={2} strokeLinejoin="round" />
      )}
      {collapsed && (
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
        onShipOpen={mode === 'edit' ? () => onShipOpen(island.slug) : undefined}
      />
      {!far && <StatColumns stats={island.stats} z={z} leftX={leftX} rightX={rightX} />}
      {/* Badges are the per-state fleet/persona readout — which is exactly what
          the far hex's number and border already are. Showing both would print
          the same fact twice, so they start at `mid`, where they become the
          clickable way INTO each state's session list. */}
      {!far && (
        <FleetBadges
          fleet={island.fleet}
          personas={island.personasRunning}
          z={z}
          yWorld={botY + 12}
          onOpenList={(state, e) => onFleetList(island.slug, state, e)}
          onOpenPersonas={(e) => onPersonasOpen(island.slug, e)}
        />
      )}
    </g>
  );
});

/** One collapsed category as an oversized hex — the far/mid body. Fullscale
 *  icon in the rolled-up status colour with the wired ratio underneath.
 *  In edit mode a click opens the category popover (which dimension is red, and
 *  act on it without zooming in) and a double-click drills into the island,
 *  exploding it back into real cells; in connect/group/note mode the cell stays
 *  inert so it never swallows the mode's own drag. */
function CategoryCell({ category, x, y, highlighted, onOpen, onDrillIn }: {
  category: CategoryNode;
  x: number;
  y: number;
  highlighted: boolean;
  /** Undefined outside edit mode — no cursor, no click, no pointer capture. */
  onOpen?: (e: React.MouseEvent) => void;
  onDrillIn?: () => void;
}) {
  const { t, tx } = useTranslation();
  const ink = DIM_INK[category.status];
  const absent = category.status === 'absent';
  const Icon = CATEGORY_ICON[category.key];
  const [hovered, setHovered] = useState(false);
  const label = t.mastermind[`dim_cat_${category.key}` as const];

  return (
    <g
      transform={`translate(${x} ${y})`}
      opacity={absent && !highlighted ? 0.6 : 1}
      style={onOpen ? { cursor: 'pointer' } : undefined}
      onPointerEnter={onOpen ? () => setHovered(true) : undefined}
      onPointerLeave={onOpen ? () => setHovered(false) : undefined}
      onPointerDown={onOpen ? (e) => e.stopPropagation() : undefined}
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(e); } : undefined}
      onDoubleClick={onDrillIn ? (e) => { e.stopPropagation(); onDrillIn(); } : undefined}
      data-testid={`mm-category-${category.key}`}
    >
      {/* the cell can't show 15 labels, so the tooltip carries the reading */}
      <title>{`${label} — ${tx(t.mastermind.dim_cat_summary, { solid: category.solid, total: category.total })}`}</title>
      <polygon
        points={hexPoints(0, 0, CAT_RADIUS - 1.5)}
        fill={absent ? mix('var(--secondary)', 45, 'var(--background)') : mix(ink, 20, 'var(--secondary)')}
        stroke={absent ? mix('var(--muted-foreground)', 40) : mix(ink, 55)}
        strokeWidth={1.5} strokeDasharray={absent ? '5 5' : undefined} strokeLinejoin="round"
      />
      {(highlighted || hovered) && (
        <polygon points={hexPoints(0, 0, CAT_RADIUS + 2)} fill="none" stroke={mix('var(--primary)', highlighted ? 95 : 70)} strokeWidth={highlighted ? 3.5 : 2} strokeLinejoin="round" />
      )}
      <Icon x={-34} y={-40} width={68} height={68} strokeWidth={1.4} style={{ color: absent ? 'var(--muted-foreground)' : ink }} />
      <text y={44} textAnchor="middle" fontSize={17} fontWeight={700} fill={absent ? 'var(--muted-foreground)' : mix(ink, 90)} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {category.solid}/{category.total}
      </text>
      {/* how MANY things are wrong in here — the count the colour can't carry */}
      {category.attention > 0 && (
        <g transform={`translate(${CAT_RADIUS * 0.62} ${-CAT_RADIUS * 0.66})`}>
          <circle r={15} fill={mix(ink, 22, 'var(--background)')} stroke={mix(ink, 80)} strokeWidth={2} />
          <text y={5.5} textAnchor="middle" fontSize={17} fontWeight={700} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {category.attention}
          </text>
        </g>
      )}
    </g>
  );
}

function MosaicCell({ node, x, y, band, highlighted, hint, onAction }: {
  node: DimNode;
  x: number;
  y: number;
  band: ZoomBand;
  highlighted: boolean;
  /** Appended to the native tooltip — used to explain a whole island's
   *  inertness (demo islands) rather than leaving a silent refusal. */
  hint?: string;
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
      <title>{`${node.label}${node.detail ? ` — ${node.detail}` : absent ? ` — ${t.mastermind.cell_empty}` : ''}${hint ? ` · ${hint}` : ''}`}</title>
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
        DIM_REGISTRY[node.key]?.payloadKind !== 'icon' && node.days != null ? (
          // numeric-payload cell: the number IS the payload when zoomed out
          // (Ideas' freshness in days, Goals' active count)
          <>
            <DimGlyph node={node} x={-8} y={-34} size={16} strokeWidth={1.75} color={ink} />
            <text y={18} textAnchor="middle" fontSize={30} fontWeight={700} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {node.days}{DIM_REGISTRY[node.key]?.payloadKind === 'days' ? 'd' : ''}
            </text>
          </>
        ) : (
          // fullscale icon — the cell IS the icon when zoomed out
          <DimGlyph node={node} x={-27} y={-27} size={54} strokeWidth={1.5} color={absent ? 'var(--muted-foreground)' : ink} />
        )
      ) : band === 'near' ? (
        // Near band — state recognition first: the dimension's icon fills the
        // whole hex as a low-opacity watermark, and the STATE VALUE takes the
        // icon's old foreground spot (ordinal progress, freshness days, or a
        // status mark for boolean dimensions). The label stays for identity.
        <>
          <g opacity={0.16} pointerEvents="none">
            <DimGlyph node={node} x={-38} y={-38} size={76} strokeWidth={1.1} color={absent ? 'var(--muted-foreground)' : ink} />
          </g>
          <text y={9} textAnchor="middle" fontSize={26} fontWeight={700} fill={absent ? 'var(--muted-foreground)' : ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {cellValue(node)}
          </text>
          <text y={34} textAnchor="middle" fontSize={9.5} letterSpacing="0.08em" fontWeight={600} fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 70)} style={{ textTransform: 'uppercase' }}>
            {node.label}
          </text>
        </>
      ) : (
        <>
          <DimGlyph node={node} x={-11} y={-30} size={22} strokeWidth={1.75} color={absent ? 'var(--muted-foreground)' : ink} />
          <text y={8} textAnchor="middle" fontSize={12} letterSpacing="0.08em" fontWeight={600} fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 90)} style={{ textTransform: 'uppercase' }}>
            {node.label}
          </text>
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
    </g>
  );
}
