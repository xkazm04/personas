// Stats side panels (round-9 winner, evolved from the ledger strip): two
// counter-scaled panels flanking the island — KPI / Errors / Uptime on the
// left, Tests / Auto / Budget on the right. One full row per stat buys the
// typography real size (17px values at every zoom) instead of the cramped
// inline strip.
import { mix, SERIF } from './ink';
import { STAT_TONE_INK, type MockStat } from './statsMock';

const W = 118;
const ROW_H = 37;
const PAD = 9;

export function StatPanels({ stats, z, leftX, rightX }: {
  stats: MockStat[];
  z: number;
  /** World-space X of the island's left/right visual edges. */
  leftX: number;
  rightX: number;
}) {
  return (
    <>
      <Panel items={stats.slice(0, 3)} z={z} x={leftX} side="left" />
      <Panel items={stats.slice(3, 6)} z={z} x={rightX} side="right" />
    </>
  );
}

function Panel({ items, z, x, side }: { items: MockStat[]; z: number; x: number; side: 'left' | 'right' }) {
  const h = items.length * ROW_H + PAD * 2;
  // The panel's inner edge sits at the anchor; it grows away from the island.
  const x0 = side === 'left' ? -W - 12 : 12;
  return (
    <g transform={`translate(${x} 0) scale(${1 / z})`} pointerEvents="none">
      <rect x={x0} y={-h / 2} width={W} height={h} rx={16} fill={mix('var(--background)', 86)} stroke={mix('var(--foreground)', 15)} strokeWidth={1} />
      {items.map((s, i) => {
        const rowY = -h / 2 + PAD + i * ROW_H;
        const ink = STAT_TONE_INK[s.tone];
        return (
          <g key={s.key} transform={`translate(${x0 + 14} ${rowY})`}>
            {i > 0 && <line x1={-2} y1={-2} x2={W - 26} y2={-2} stroke={mix('var(--foreground)', 9)} strokeWidth={1} />}
            <circle cx={2.5} cy={11.5} r={3} fill={ink} />
            <text x={11} y={14.5} fontSize={9} letterSpacing="0.13em" fill={mix('var(--foreground)', 60)} style={{ textTransform: 'uppercase' }}>
              {s.label}
            </text>
            <text x={W - 26} y={31} textAnchor="end" fontSize={17} fontWeight={600} fontFamily={SERIF} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </text>
          </g>
        );
      })}
    </g>
  );
}
