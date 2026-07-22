// STATS DIRECTION B — "Orbit gauges": six world-space ring gauges moored in a
// row under the island. They live IN the map (scale with zoom, like terrain);
// values surface at mid+, labels at near+ — colour + fill carry the story far
// out. Full ring always means good (arcs pre-normalized in the mock).
import { mix } from './ink';
import { STAT_TONE_INK, type MockStat } from './statsMock';

const R = 21;
const SPACING = 56;
const CIRC = 2 * Math.PI * R;

export function StatGauges({ stats, z, yWorld }: {
  stats: MockStat[];
  z: number;
  /** World-space anchor below the island's visual bottom. */
  yWorld: number;
}) {
  return (
    <g pointerEvents="none">
      {stats.map((s, i) => {
        const cx = (i - (stats.length - 1) / 2) * SPACING;
        const ink = STAT_TONE_INK[s.tone];
        return (
          <g key={s.key} transform={`translate(${cx} ${yWorld + R + 10})`}>
            <circle r={R} fill={mix('var(--secondary)', 55, 'var(--background)')} stroke={mix('var(--foreground)', 12)} strokeWidth={4} />
            <circle
              r={R} fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round"
              strokeDasharray={`${Math.max(0.04, Math.min(1, s.arc)) * CIRC} ${CIRC}`}
              transform="rotate(-90)"
            />
            {z >= 0.45 && (
              <text y={4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {s.value}
              </text>
            )}
            {z >= 0.8 && (
              <text y={R + 13} textAnchor="middle" fontSize={7.5} letterSpacing="0.13em" fill={mix('var(--foreground)', 55)} style={{ textTransform: 'uppercase' }}>
                {s.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
