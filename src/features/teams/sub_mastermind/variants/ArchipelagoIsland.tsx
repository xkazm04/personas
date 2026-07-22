// One project as a cartographic island: soft-coast landmass (blurred hex
// plates, per-slug rotation for organic variety), isoline contours, a serif
// nameplate core, and dimension satellites on the ring. Absent wiring renders
// as a greyed, dashed "uncharted" hex — visible, never hidden.
import { hash01, hexPoints, satellitePositions } from '../lib/hex';
import { DIM_ICON } from '../lib/dimMeta';
import { DIM_INK, mix, SERIF, STATE_INK } from '../lib/ink';
import { useIslandDrag } from '../lib/useIslandDrag';
import type { CanvasMode, DimNode, Island, ZoomMode } from '../lib/types';

const LAND_R = 150;
const CORE_R = 64;
const NODE_RING = 106;
const NODE_R = 30;

const COPY = { uncharted: 'not set up' };

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function ArchipelagoIsland({ island, zoom, z, mode, dimmed, onHover, onIslandMove, onIslandCommit }: {
  island: Island;
  zoom: ZoomMode;
  z: number;
  mode: CanvasMode;
  dimmed: boolean;
  onHover: (slug: string | null) => void;
  onIslandMove: (slug: string, x: number, y: number) => void;
  onIslandCommit: (slug: string, x: number, y: number) => void;
}) {
  const ink = STATE_INK[island.state];
  const seed = hash01(island.slug);
  const positions = satellitePositions(island.nodes.length, NODE_RING, NODE_RING + 62);
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
      {/* landmass — two soft plates; the outer carries the state tint like shallows */}
      <polygon points={hexPoints(0, 0, LAND_R + 30, false, seed * 60)} fill={mix(ink, 9, 'var(--secondary)')} opacity={0.55} filter="url(#mm-coast)" />
      <polygon
        points={hexPoints(0, 0, LAND_R, false, seed * -42)}
        fill={mix('var(--secondary)', 55, 'var(--background)')}
        stroke={mix(ink, 28)} strokeWidth={1.5} strokeLinejoin="round" opacity={0.92}
      />

      {/* isoline contours — the cartographic signature; hidden when far */}
      {zoom !== 'far' && (
        <>
          <circle r={LAND_R + 40} fill="none" stroke={mix('var(--foreground)', 9)} strokeWidth={1.2} strokeDasharray="1 7" strokeLinecap="round" />
          <circle r={LAND_R + 64} fill="none" stroke={mix('var(--foreground)', 5)} strokeWidth={1} strokeDasharray="1 9" strokeLinecap="round" />
        </>
      )}

      {/* dimension satellites */}
      {zoom !== 'far' && island.nodes.map((n, k) => {
        const p = positions[k];
        return p ? <Satellite key={n.key} node={n} x={p.x} y={p.y} mode={zoom} /> : null;
      })}

      {/* core nameplate */}
      {zoom === 'far' ? (
        <circle r={30} fill={mix(ink, 55, 'var(--secondary)')} stroke={mix(ink, 80)} strokeWidth={3} />
      ) : (
        <g>
          <polygon
            points={hexPoints(0, 0, CORE_R)}
            fill={mix('var(--background)', 84, ink)}
            stroke={mix(ink, 72)} strokeWidth={2.5} strokeLinejoin="round"
          />
          <text y={-4} textAnchor="middle" fontSize={17} fontWeight={600} fontFamily={SERIF} fill="var(--foreground)" letterSpacing="0.01em">
            {trunc(island.name, 14)}
          </text>
          <text y={13} textAnchor="middle" fontSize={8} letterSpacing="0.14em" fill={mix('var(--foreground)', 55)} style={{ textTransform: 'uppercase' }}>
            {island.automationLabel} · {island.lifecycle}
          </text>
          <text y={30} textAnchor="middle" fontSize={10.5} fontFamily={SERIF} fontStyle="italic" fill={mix('var(--foreground)', 62)} style={{ fontVariantNumeric: 'tabular-nums' }}>
            auto {island.autoScore} · prod {island.prodScore}
          </text>
          {island.blockers > 0 && (
            <g transform={`translate(${CORE_R * 0.68} ${-CORE_R * 0.68})`}>
              <circle r={11} fill={mix('var(--status-error)', 18, 'var(--background)')} stroke={mix('var(--status-error)', 70)} strokeWidth={1.5} />
              <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--status-error)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {island.blockers}
              </text>
            </g>
          )}
        </g>
      )}
    </g>
  );
}

function Satellite({ node, x, y, mode }: { node: DimNode; x: number; y: number; mode: ZoomMode }) {
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';

  if (mode === 'mid') {
    return (
      <circle
        cx={x} cy={y} r={9}
        fill={absent ? 'transparent' : ink}
        stroke={ink} strokeWidth={absent ? 1.5 : 0} strokeDasharray={absent ? '2.5 3' : undefined}
        opacity={absent ? 0.5 : 0.9}
      />
    );
  }

  const Icon = DIM_ICON[node.key];
  return (
    <g transform={`translate(${x} ${y})`} opacity={absent ? 0.55 : 1}>
      <polygon
        points={hexPoints(0, 0, NODE_R)}
        fill={absent ? mix('var(--secondary)', 40, 'var(--background)') : mix(ink, 13, 'var(--background)')}
        stroke={absent ? mix('var(--muted-foreground)', 45) : mix(ink, 62)}
        strokeWidth={1.5} strokeDasharray={absent ? '4 4' : undefined} strokeLinejoin="round"
      />
      <Icon x={-8} y={-15} width={16} height={16} strokeWidth={1.75} style={{ color: absent ? 'var(--muted-foreground)' : ink }} />
      <text y={12} textAnchor="middle" fontSize={7.5} letterSpacing="0.13em" fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 85)} style={{ textTransform: 'uppercase' }}>
        {node.label}
      </text>
      <text y={NODE_R + 14} textAnchor="middle" fontSize={9.5} fontFamily={SERIF} fontStyle="italic" fill={absent ? mix('var(--muted-foreground)', 80) : mix('var(--foreground)', 62)}>
        {node.detail ?? (absent ? COPY.uncharted : '')}
      </text>
    </g>
  );
}
