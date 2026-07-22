// Floating name banner — the readability workhorse. Rendered in world space
// but counter-scaled by 1/z, so it keeps a constant SCREEN size at every zoom
// (the Civilization city-label pattern): project identity + state + scores are
// legible from the farthest overview to the closest inspection.
import { mix, SERIF, STATE_INK } from './ink';
import type { Island } from './types';

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function IslandBanner({ island, z, topWorldY }: {
  island: Island;
  z: number;
  /** World-space Y of the banner anchor (above the island's visual top). */
  topWorldY: number;
}) {
  const ink = STATE_INK[island.state];
  const name = trunc(island.name, 26);
  const hasFlag = island.blockers > 0;
  const w = Math.min(330, Math.max(150, name.length * 7.4 + (hasFlag ? 128 : 104)));
  const k = 1 / z;
  return (
    <g transform={`translate(0 ${topWorldY}) scale(${k})`} pointerEvents="none">
      <g transform="translate(0 -16)">
        <rect
          x={-w / 2} y={-14} width={w} height={28} rx={14}
          fill={mix('var(--background)', 86)}
          stroke={mix(ink, 55)} strokeWidth={1.25}
        />
        <circle cx={-w / 2 + 15} r={4} fill={ink} />
        <text x={-w / 2 + 27} y={4.5} fontSize={13} fontWeight={600} fontFamily={SERIF} fill="var(--foreground)" letterSpacing="0.01em">
          {name}
        </text>
        {hasFlag && (
          <text x={w / 2 - 58} y={4} textAnchor="end" fontSize={10.5} fontWeight={700} fill="var(--status-error)" style={{ fontVariantNumeric: 'tabular-nums' }}>
            !{island.blockers}
          </text>
        )}
        <text x={w / 2 - 13} y={4} textAnchor="end" fontSize={10} fill={mix('var(--foreground)', 55)} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {island.autoScore}·{island.prodScore}
        </text>
      </g>
    </g>
  );
}
