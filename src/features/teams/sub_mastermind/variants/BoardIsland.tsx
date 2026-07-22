// One project as a component board: header row (identity + scores) over a
// 4×2 matrix of dimension tiles — rectangular structure that composes and
// scans logically. Below the header-legibility threshold the counter-scaled
// banner takes over identity; tile colour always carries state, so the far
// view is a neat readable matrix, never micro-text.
import { DIM_ICON } from '../lib/dimMeta';
import { DIM_INK, mix, scoreInkVar, SERIF, STATE_INK } from '../lib/ink';
import { IslandBanner } from '../lib/IslandBanner';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { CanvasMode, DimNode, Island } from '../lib/types';

const W = 336;
const H = 196;
const PAD = 12;
const HEADER = 50;
const GAP = 6;
const TILE_W = (W - PAD * 2 - GAP * 3) / 4;
const TILE_H = (H - HEADER - PAD - GAP) / 2;

const COPY = { empty: 'not set up' };

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function BoardIsland({ island, z, mode, dimmed, onHover, onIslandMove, onIslandCommit }: {
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
  // Header text is legible from z≈0.55 (17px world ≥ ~9px screen); below that
  // the floating banner carries identity instead.
  const headerLegible = z >= 0.55;

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
          {z >= 0.9 && (
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
        return <Tile key={n.key} node={n} x={tx} y={ty} z={z} />;
      })}

      {!headerLegible && <IslandBanner island={island} z={z} topWorldY={-H / 2 - 12} />}
    </g>
  );
}

function Tile({ node, x, y, z }: { node: DimNode; x: number; y: number; z: number }) {
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';
  const Icon = DIM_ICON[node.key];
  const showIcon = z >= 0.5;
  const showLabel = z >= 0.8;
  const showDetail = z >= 1.05;

  return (
    <g transform={`translate(${x} ${y})`} opacity={absent ? 0.6 : 1}>
      <rect
        width={TILE_W} height={TILE_H} rx={8}
        fill={absent ? mix('var(--secondary)', 40, 'var(--background)') : mix(ink, 16, 'var(--background)')}
        stroke={absent ? mix('var(--muted-foreground)', 38) : mix(ink, 50)}
        strokeWidth={1.25} strokeDasharray={absent ? '5 5' : undefined}
      />
      {showIcon && (
        <Icon x={8} y={8} width={17} height={17} strokeWidth={1.75} style={{ color: absent ? 'var(--muted-foreground)' : ink }} />
      )}
      {showLabel && (
        <text x={TILE_W - 8} y={20} textAnchor="end" fontSize={9} letterSpacing="0.08em" fontWeight={600} fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 88)} style={{ textTransform: 'uppercase' }}>
          {node.label}
        </text>
      )}
      {showDetail && (
        <text x={8} y={TILE_H - 18} fontSize={9.5} fontStyle="italic" fontFamily={SERIF} fill={absent ? mix('var(--muted-foreground)', 85) : mix('var(--foreground)', 68)}>
          {trunc(node.detail ?? (absent ? COPY.empty : ''), 13)}
        </text>
      )}
      {showDetail && node.steps > 0 && !absent && (
        <g transform={`translate(8 ${TILE_H - 9})`}>
          <rect y={-1.75} width={TILE_W - 16} height={3.5} rx={1.75} fill={mix('var(--foreground)', 10)} />
          <rect y={-1.75} width={((TILE_W - 16) * node.reached) / node.steps} height={3.5} rx={1.75} fill={ink} />
        </g>
      )}
    </g>
  );
}
