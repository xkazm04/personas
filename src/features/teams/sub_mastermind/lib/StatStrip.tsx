// STATS DIRECTION A — "Ledger strip": a counter-scaled pill row docked under
// the island, six label/value pairs in the banner's serif+tabular language.
// Constant screen size = numbers stay readable at every zoom, like the banner.
import { mix, SERIF } from './ink';
import { STAT_TONE_INK, type MockStat } from './statsMock';

const CELL_W = 58;

export function StatStrip({ stats, z, yWorld }: {
  stats: MockStat[];
  z: number;
  /** World-space anchor below the island's visual bottom. */
  yWorld: number;
}) {
  const w = stats.length * CELL_W + 16;
  return (
    <g transform={`translate(0 ${yWorld}) scale(${1 / z})`} pointerEvents="none">
      <g transform="translate(0 18)">
        <rect x={-w / 2} y={-16} width={w} height={34} rx={17} fill={mix('var(--background)', 86)} stroke={mix('var(--foreground)', 14)} strokeWidth={1} />
        {stats.map((s, i) => (
          <g key={s.key} transform={`translate(${-w / 2 + 8 + CELL_W * i + CELL_W / 2} 0)`}>
            <text y={-4} textAnchor="middle" fontSize={7} letterSpacing="0.13em" fill={mix('var(--foreground)', 50)} style={{ textTransform: 'uppercase' }}>
              {s.label}
            </text>
            <text y={10} textAnchor="middle" fontSize={11.5} fontWeight={600} fontFamily={SERIF} fill={STAT_TONE_INK[s.tone]} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </text>
            {i > 0 && <line x1={-CELL_W / 2} y1={-11} x2={-CELL_W / 2} y2={11} stroke={mix('var(--foreground)', 9)} strokeWidth={1} />}
          </g>
        ))}
      </g>
    </g>
  );
}
