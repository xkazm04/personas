// One project as a tactical hex formation: flat-top command hex with mono
// uppercase callsign, twin readiness meters, corner blocker tally, and
// dimension hexes snapped to the six adjacency directions (+2 outposts).
// Absent wiring = dashed empty cell, like an unclaimed tile.
import { DIM_ICON } from '../lib/dimMeta';
import { DIM_INK, mix, MONO, scoreInkVar, STATE_INK } from '../lib/ink';
import { hexPoints } from '../lib/hex';
import type { DimNode, Island, ZoomMode } from '../lib/types';

const CORE_R = 80;
const NODE_R = 34;
const RING = CORE_R + NODE_R + 10;

const COPY = { auto: 'AUTO', prod: 'PROD', empty: 'EMPTY' };

const D2R = Math.PI / 180;
// Flat-top adjacency directions (30° + k·60°), ring-2 outposts between spokes.
const nodePos = (k: number) => {
  const ring2 = k >= 6;
  const a = (ring2 ? 0 + (k - 6) * 120 : 30 + k * 60) * D2R;
  const r = ring2 ? RING + NODE_R * 1.9 : RING;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
};

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function GridIsland({ island, mode, dimmed, onHover }: {
  island: Island;
  mode: ZoomMode;
  dimmed: boolean;
  onHover: (slug: string | null) => void;
}) {
  const ink = STATE_INK[island.state];

  return (
    <g
      transform={`translate(${island.x} ${island.y})`}
      style={{ opacity: dimmed ? 0.25 : 1, transition: 'opacity 200ms ease' }}
      onPointerEnter={() => onHover(island.slug)}
      onPointerLeave={() => onHover(null)}
      data-testid={`mm-island-${island.slug}`}
    >
      {/* claim zone — a faint territory ring behind the formation */}
      {mode !== 'far' && (
        <polygon points={hexPoints(0, 0, RING + NODE_R + 16, true)} fill={mix(ink, 4)} stroke={mix(ink, 14)} strokeWidth={1} />
      )}

      {/* dimension cells */}
      {mode !== 'far' && island.nodes.map((n, k) => {
        const p = nodePos(k);
        return <Cell key={n.key} node={n} x={p.x} y={p.y} mode={mode} />;
      })}

      {/* command hex */}
      <polygon
        points={hexPoints(0, 0, mode === 'far' ? 46 : CORE_R, true)}
        fill={mode === 'far' ? mix(ink, 30, 'var(--secondary)') : mix(ink, 8, 'var(--secondary)')}
        stroke={mix(ink, 85)}
        strokeWidth={mode === 'far' ? 3 : 1.5}
      />
      {mode !== 'far' && (
        <g fontFamily={MONO}>
          <text y={-20} textAnchor="middle" fontSize={13.5} fontWeight={700} letterSpacing="0.1em" fill="var(--foreground)" style={{ textTransform: 'uppercase' }}>
            {trunc(island.name, 13)}
          </text>
          <text y={-6} textAnchor="middle" fontSize={7.5} letterSpacing="0.18em" fill={mix('var(--foreground)', 50)} style={{ textTransform: 'uppercase' }}>
            {island.lifecycle}
          </text>
          <Meter y={8} label={COPY.auto} score={island.autoScore} />
          <Meter y={24} label={COPY.prod} score={island.prodScore} />
          {island.blockers > 0 && (
            <g transform={`translate(${CORE_R * 0.62} ${-CORE_R * 0.62})`}>
              <rect x={-11} y={-8} width={22} height={16} fill={mix('var(--status-error)', 16, 'var(--background)')} stroke={mix('var(--status-error)', 75)} strokeWidth={1.25} />
              <text y={4} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--status-error)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                !{island.blockers}
              </text>
            </g>
          )}
        </g>
      )}
    </g>
  );
}

/** Thin readiness meter: mono micro-label · track · score readout. */
function Meter({ y, label, score }: { y: number; label: string; score: number }) {
  const ink = scoreInkVar(score);
  const W = 76;
  return (
    <g transform={`translate(0 ${y})`}>
      <text x={-W / 2 - 6} y={3.5} textAnchor="end" fontSize={7} letterSpacing="0.12em" fill={mix('var(--foreground)', 45)}>{label}</text>
      <rect x={-W / 2} y={-2} width={W} height={4} fill={mix('var(--foreground)', 10)} />
      <rect x={-W / 2} y={-2} width={(W * Math.max(0, Math.min(100, score))) / 100} height={4} fill={ink} />
      <text x={W / 2 + 6} y={3.5} fontSize={8.5} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{score}</text>
    </g>
  );
}

function Cell({ node, x, y, mode }: { node: DimNode; x: number; y: number; mode: ZoomMode }) {
  const ink = DIM_INK[node.status];
  const absent = node.status === 'absent';

  if (mode === 'mid') {
    return (
      <polygon
        points={hexPoints(x, y, 11, true)}
        fill={absent ? 'transparent' : ink}
        stroke={ink} strokeWidth={absent ? 1.25 : 0} strokeDasharray={absent ? '3 3' : undefined}
        opacity={absent ? 0.45 : 0.9}
      />
    );
  }

  const Icon = DIM_ICON[node.key];
  return (
    <g transform={`translate(${x} ${y})`} fontFamily={MONO} opacity={absent ? 0.55 : 1}>
      <polygon
        points={hexPoints(0, 0, NODE_R, true)}
        fill={absent ? 'transparent' : mix(ink, 11, 'var(--background)')}
        stroke={absent ? mix('var(--muted-foreground)', 50) : mix(ink, 70)}
        strokeWidth={1.25} strokeDasharray={absent ? '5 4' : undefined}
      />
      <Icon x={-8} y={-16} width={16} height={16} strokeWidth={1.75} style={{ color: absent ? 'var(--muted-foreground)' : ink }} />
      <text y={12} textAnchor="middle" fontSize={6.5} letterSpacing="0.16em" fill={absent ? 'var(--muted-foreground)' : mix('var(--foreground)', 85)} style={{ textTransform: 'uppercase' }}>
        {node.label}
      </text>
      {node.steps > 0 && !absent && (
        <text y={22} textAnchor="middle" fontSize={7} fill={mix('var(--foreground)', 45)} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {node.reached}/{node.steps}
        </text>
      )}
      <text y={NODE_R + 13} textAnchor="middle" fontSize={8} letterSpacing="0.06em" fill={absent ? mix('var(--muted-foreground)', 85) : mix('var(--foreground)', 60)} style={{ textTransform: 'uppercase' }}>
        {node.detail ?? (absent ? COPY.empty : '')}
      </text>
    </g>
  );
}
