// Ops badges under the island: fleet terminal sessions aggregate into
// per-state count badges, and in-progress PERSONAS get their own badge at the
// end of the same row (round 14 — the Monitor's other LLM-operation lane).
// Counter-scaled pill row; clicks open the respective list popovers.
import { Bot } from 'lucide-react';

import { FLEET_INK, mix, SERIF } from './ink';
import { FLEET_STATE_ORDER } from './fleetMeta';
import type { FleetNode } from './types';

const BADGE_W = 46;
const PERSONA_INK = 'var(--status-processing)';

export function FleetBadges({ fleet, personas = [], z, yWorld, onOpenList, onOpenPersonas }: {
  fleet: FleetNode[];
  /** Names of personas with an execution in progress (persona badge). */
  personas?: string[];
  z: number;
  /** World-space Y anchor below the island's visual bottom. */
  yWorld: number;
  /** Badge clicked — open the state-filtered session list at the cursor. */
  onOpenList: (state: string, e: React.MouseEvent) => void;
  /** Persona badge clicked — open the persona name list at the cursor. */
  onOpenPersonas?: (e: React.MouseEvent) => void;
}) {
  if (fleet.length === 0 && personas.length === 0) return null;
  const counts = new Map<string, number>();
  for (const f of fleet) counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  const states: string[] = (FLEET_STATE_ORDER as readonly string[]).filter((s) => counts.has(s)).concat(
    [...counts.keys()].filter((s) => !(FLEET_STATE_ORDER as readonly string[]).includes(s)),
  );
  const slots = states.length + (personas.length > 0 ? 1 : 0);
  const w = slots * (BADGE_W + 6) - 6;
  const personaCx = -w / 2 + states.length * (BADGE_W + 6) + BADGE_W / 2;

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
        {personas.length > 0 && (
          <g
            transform={`translate(${personaCx} 0)`}
            style={{ cursor: 'pointer' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenPersonas?.(e); }}
            data-testid="mm-persona-badge"
          >
            <title>{`${personas.length} persona${personas.length === 1 ? '' : 's'} in progress`}</title>
            <rect x={-BADGE_W / 2} y={-14} width={BADGE_W} height={28} rx={14} fill={mix(PERSONA_INK, 16, 'var(--background)')} stroke={mix(PERSONA_INK, 55)} strokeWidth={1.25} />
            <Bot x={-BADGE_W / 2 + 6} y={-8} width={16} height={16} strokeWidth={1.75} style={{ color: PERSONA_INK }} />
            <text x={9} y={5} textAnchor="middle" fontSize={14} fontWeight={600} fontFamily={SERIF} fill="var(--foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {personas.length}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}
