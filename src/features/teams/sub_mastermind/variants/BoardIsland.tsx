// One project as a component board: header row (identity + scores) over a
// 4×2 matrix of dimension tiles. Round-3 LOD: far/mid show fullscale icons in
// every tile with the banner carrying an enlarged title; header text takes
// over at near; details/progress arrive at close.
import { DimTile } from '../lib/DimTile';
import { mix, scoreInkVar, SERIF, STATE_INK } from '../lib/ink';
import { IslandBanner } from '../lib/IslandBanner';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { IslandCtx } from '../lib/CanvasShell';
import type { Island } from '../lib/types';
import { bandGte } from '../lib/types';

const W = 336;
const H = 196;
const PAD = 12;
const HEADER = 50;
const GAP = 6;
const TILE_W = (W - PAD * 2 - GAP * 3) / 4;
const TILE_H = (H - HEADER - PAD - GAP) / 2;

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function BoardIsland({ island, z, band, mode, dimmed, onHover, onIslandMove, onIslandCommit }: { island: Island } & IslandCtx) {
  const ink = STATE_INK[island.state];
  const drag = useIslandDrag({ enabled: mode === 'edit', z, slug: island.slug, x: island.x, y: island.y, onMove: onIslandMove, onCommit: onIslandCommit });
  // Header text is legible from `near`; below that the floating banner carries identity.
  const headerLegible = bandGte(band, 'near');

  return (
    <g
      transform={`translate(${island.x} ${island.y})`}
      style={{ opacity: dimmed ? 0.3 : 1, transition: 'opacity 200ms ease', cursor: mode === 'edit' ? 'move' : undefined }}
      onPointerEnter={() => onHover(island.slug)}
      onPointerLeave={() => onHover(null)}
      {...drag}
      data-testid={`mm-island-${island.slug}`}
    >
      <rect x={-W / 2 - 10} y={-H / 2 - 10} width={W + 20} height={H + 20} rx={22} fill={mix(ink, 9, 'var(--secondary)')} opacity={0.55} filter="url(#mm-coast)" />
      <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={14} fill={mix('var(--secondary)', 62, 'var(--background)')} stroke={mix(ink, 45)} strokeWidth={1.5} />
      <rect x={-W / 2 + 14} y={-H / 2 + 5} width={W - 28} height={3} rx={1.5} fill={mix(ink, 80)} />

      {headerLegible && (
        <g>
          <circle cx={-W / 2 + PAD + 7} cy={-H / 2 + 30} r={4.5} fill={ink} />
          <text x={-W / 2 + PAD + 20} y={-H / 2 + 35} fontSize={17} fontWeight={600} fontFamily={SERIF} fill="var(--foreground)">
            {trunc(island.name, 19)}
          </text>
          {island.blockers > 0 && (
            <text x={W / 2 - PAD - 58} y={-H / 2 + 34} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--status-error)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              !{island.blockers}
            </text>
          )}
          <text x={W / 2 - PAD} y={-H / 2 + 28} textAnchor="end" fontSize={11} fontWeight={600} fill={scoreInkVar(island.autoScore)} style={{ fontVariantNumeric: 'tabular-nums' }}>
            A {island.autoScore}
          </text>
          <text x={W / 2 - PAD} y={-H / 2 + 41} textAnchor="end" fontSize={11} fontWeight={600} fill={scoreInkVar(island.prodScore)} style={{ fontVariantNumeric: 'tabular-nums' }}>
            P {island.prodScore}
          </text>
          {band === 'close' && (
            <text x={-W / 2 + PAD + 20} y={-H / 2 + 47} fontSize={8} letterSpacing="0.14em" fill={mix('var(--foreground)', 50)} style={{ textTransform: 'uppercase' }}>
              {island.automationLabel} · {island.lifecycle}
            </text>
          )}
        </g>
      )}

      {island.nodes.map((n, k) => {
        const col = k % 4;
        const row = Math.floor(k / 4);
        const tx = -W / 2 + PAD + col * (TILE_W + GAP);
        const ty = -H / 2 + HEADER + row * (TILE_H + GAP);
        return <DimTile key={n.key} node={n} x={tx} y={ty} w={TILE_W} h={TILE_H} band={band} />;
      })}

      {!headerLegible && <IslandBanner island={island} z={z} band={band} topWorldY={-H / 2 - 12} />}
    </g>
  );
}
