// Fleet dock — a counter-scaled row of session nodes moored under an island:
// one dot per open Fleet CLI session working in that project, coloured by live
// session state. Constant screen size (like the banner) so the dots stay
// clickable at any zoom. Click opens the CLI preview popover.
import { FLEET_INK, mix, MONO } from './ink';
import type { FleetNode } from './types';

const R = 9;
const GAP = 26;

export function FleetDock({ fleet, z, yWorld, onOpen }: {
  fleet: FleetNode[];
  z: number;
  /** World-space Y anchor (below the island's visual bottom). */
  yWorld: number;
  onOpen: (sessionId: string) => void;
}) {
  if (fleet.length === 0) return null;
  const w = (fleet.length - 1) * GAP;
  return (
    <g transform={`translate(0 ${yWorld}) scale(${1 / z})`}>
      <g transform="translate(0 14)">
        {fleet.map((f, i) => {
          const ink = FLEET_INK[f.state] ?? 'var(--status-neutral)';
          const cx = -w / 2 + i * GAP;
          return (
            <g
              key={f.id}
              transform={`translate(${cx} 0)`}
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpen(f.id); }}
              data-testid={`mm-fleet-${f.id}`}
            >
              <title>{`${f.label} — ${f.state.replace('_', ' ')}`}</title>
              <circle r={R + 3.5} fill={mix(ink, 14, 'var(--background)')} stroke={mix(ink, 40)} strokeWidth={1} />
              <circle r={R} fill={ink} />
              {/* terminal glyph — marks these as CLI windows, not dimensions */}
              <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily={MONO} fill="var(--background)" pointerEvents="none">
                {'>'}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}
