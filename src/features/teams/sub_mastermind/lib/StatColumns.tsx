// STATS DIRECTION C (round 10) — "Columns": no panel chrome at all. Two
// transparent columns flanking the island, each row just a stat-type icon +
// the number (space-efficient far-zoom design that blends with the map).
// Text carries a background halo (paintOrder stroke) so values stay legible
// on the open sea; counter-scaled, so sizing holds at every zoom.
import { AlertTriangle, Bot, CircleDollarSign, FlaskConical, Gauge, HeartPulse, type LucideIcon } from 'lucide-react';

import { mix, SERIF } from './ink';
import { STAT_TONE_INK, type MockStat } from './statsMock';

const STAT_ICON: Record<string, LucideIcon> = {
  kpi: Gauge,
  errors: AlertTriangle,
  uptime: HeartPulse,
  coverage: FlaskConical,
  autonomy: Bot,
  budget: CircleDollarSign,
};

const ROW_H = 32;

export function StatColumns({ stats, z, leftX, rightX }: {
  stats: MockStat[];
  z: number;
  /** World-space X of the island's left/right visual edges. */
  leftX: number;
  rightX: number;
}) {
  return (
    <>
      <Col items={stats.slice(0, 3)} z={z} x={leftX} side="left" />
      <Col items={stats.slice(3, 6)} z={z} x={rightX} side="right" />
    </>
  );
}

function Col({ items, z, x, side }: { items: MockStat[]; z: number; x: number; side: 'left' | 'right' }) {
  const h = items.length * ROW_H;
  const sign = side === 'left' ? -1 : 1;
  return (
    <g transform={`translate(${x} 0) scale(${1 / z})`} pointerEvents="none">
      {items.map((s, i) => {
        const y = -h / 2 + i * ROW_H + ROW_H / 2;
        const ink = STAT_TONE_INK[s.tone];
        const Icon = STAT_ICON[s.key] ?? Gauge;
        return (
          <g key={s.key}>
            <title>{s.label}</title>
            <Icon x={sign * 16 - 8} y={y - 8} width={16} height={16} strokeWidth={2} style={{ color: ink }} />
            <text
              x={sign * 34}
              y={y + 5.5}
              textAnchor={side === 'left' ? 'end' : 'start'}
              fontSize={16}
              fontWeight={600}
              fontFamily={SERIF}
              fill={ink}
              style={{
                fontVariantNumeric: 'tabular-nums',
                paintOrder: 'stroke',
                stroke: mix('var(--background)', 85),
                strokeWidth: 3.5,
                strokeLinejoin: 'round',
              }}
            >
              {s.value}
            </text>
          </g>
        );
      })}
    </g>
  );
}
