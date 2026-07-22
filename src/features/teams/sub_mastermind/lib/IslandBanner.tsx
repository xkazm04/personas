// Floating name banner — the readability workhorse. Rendered in world space
// but counter-scaled by 1/z, so it keeps a constant SCREEN size at every zoom
// (the Civilization city-label pattern). Round 3: the title grows as the
// camera pulls back (far > mid > near) so distant identity reads instantly.
import { mix, SERIF, STATE_INK } from './ink';
import type { Island, ZoomBand } from './types';

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Screen-px title size per band — bigger when zoomed out, and (round 4)
 *  raised at near/close so the name stays commanding during inspection. */
const TITLE_FS: Record<ZoomBand, number> = { far: 20, mid: 18, near: 17, close: 16 };

export function IslandBanner({ island, z, band, topWorldY }: {
  island: Island;
  z: number;
  band: ZoomBand;
  /** World-space Y of the banner anchor (above the island's visual top). */
  topWorldY: number;
}) {
  const ink = STATE_INK[island.state];
  const name = trunc(island.name, 26);
  const hasFlag = island.blockers > 0;
  const fs = TITLE_FS[band];
  const h = fs + 16;
  const metaW = (hasFlag ? 24 : 0) + 44;
  const w = Math.min(430, Math.max(150, name.length * fs * 0.58 + metaW + 62));
  const k = 1 / z;
  return (
    <g transform={`translate(0 ${topWorldY}) scale(${k})`} pointerEvents="none">
      <g transform={`translate(0 ${-h / 2 - 2})`}>
        <rect
          x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2}
          fill={mix('var(--background)', 86)}
          stroke={mix(ink, 55)} strokeWidth={1.25}
        />
        <circle cx={-w / 2 + h / 2} r={fs * 0.33} fill={ink} />
        <text x={-w / 2 + h / 2 + 12} y={fs * 0.36} fontSize={fs} fontWeight={600} fontFamily={SERIF} fill="var(--foreground)" letterSpacing="0.01em">
          {name}
        </text>
        {hasFlag && (
          <text x={w / 2 - 56} y={4} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--status-error)" style={{ fontVariantNumeric: 'tabular-nums' }}>
            !{island.blockers}
          </text>
        )}
        <text x={w / 2 - 13} y={4} textAnchor="end" fontSize={10.5} fill={mix('var(--foreground)', 55)} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {island.autoScore}·{island.prodScore}
        </text>
      </g>
    </g>
  );
}
