// FLEET DIRECTION B — "Badges": the island keeps its bottom space; sessions
// aggregate into per-state count badges (counter-scaled pill row). Clicking a
// badge opens the session-list popover (shell-rendered) to pick a terminal.
import { FLEET_INK, mix, SERIF } from './ink';
import { FLEET_STATE_ORDER } from './fleetMeta';
import type { FleetNode } from './types';

const BADGE_W = 46;

export function FleetBadges({ fleet, z, yWorld, onOpenList }: {
  fleet: FleetNode[];
  z: number;
  /** World-space Y anchor below the island's visual bottom. */
  yWorld: number;
  /** Badge clicked — open the state-filtered session list at the cursor. */
  onOpenList: (state: string, e: React.MouseEvent) => void;
}) {
  if (fleet.length === 0) return null;
  const counts = new Map<string, number>();
  for (const f of fleet) counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  const states: string[] = (FLEET_STATE_ORDER as readonly string[]).filter((s) => counts.has(s)).concat(
    [...counts.keys()].filter((s) => !(FLEET_STATE_ORDER as readonly string[]).includes(s)),
  );
  const w = states.length * (BADGE_W + 6) - 6;

  return (
    <g transform={`translate(0 ${yWorld}) scale(${1 / z})`}>
      <g transform="translate(0 18)">
        {states.map((state, i) => {
          const ink = FLEET_INK[state] ?? 'var(--status-neutral)';
          const cx = -w / 2 + i * (BADGE_W + 6) + BADGE_W / 2;
          return (
            <g
              key={state}
              transform={`translate(${cx} 0)`}
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenList(state, e); }}
              data-testid={`mm-fleet-badge-${state}`}
            >
              <title>{`${counts.get(state)} × ${state.replace('_', ' ')}`}</title>
              <rect x={-BADGE_W / 2} y={-14} width={BADGE_W} height={28} rx={14} fill={mix(ink, 16, 'var(--background)')} stroke={mix(ink, 55)} strokeWidth={1.25} />
              {/* awaiting_input pulses — a terminal is literally waiting on the user */}
              {state === 'awaiting_input' && (
                <circle
                  cx={-BADGE_W / 2 + 13} r={7} fill={ink} opacity={0.5}
                  className="animate-ping"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                />
              )}
              <circle cx={-BADGE_W / 2 + 13} r={4} fill={ink} />
              <text x={7} y={5} textAnchor="middle" fontSize={14} fontWeight={600} fontFamily={SERIF} fill="var(--foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {counts.get(state)}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}
