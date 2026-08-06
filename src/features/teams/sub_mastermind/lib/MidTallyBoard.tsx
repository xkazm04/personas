// MID VARIANT B (round 2) — "Tally".
//
// METAPHOR: a unit chart. Where Facet reads the lanes as AGGREGATES (one bold
// number per face), Tally draws one pip PER PROCESS in three rows inside the
// same hex — you don't read a count, you count things. The payoff is
// granularity an aggregate cannot give: each Fleet pip wears its own session's
// state ink, so one stuck session is visibly THE violet pip among the green
// ones, and a queued runner task is a hollow pip next to the filled running
// one. The count numeral at the row's end confirms what the pips show.
//
// Same silhouette discipline as Facet: everything lives inside the far band's
// hex (FAR_RADIUS), so nothing can collide with the banner, badges or stat
// columns, and far→mid keeps one shape on screen. Words live in tooltips; the
// only text is numerals.
import { useTranslation } from '@/i18n/useTranslation';

import { FAR_RADIUS } from './FarProcessHex';
import { FLEET_STATE_ORDER } from './fleetMeta';
import { hexPoints } from './hex';
import { FLEET_INK, mix, SERIF } from './ink';
import { LANE_ICON, laneTip } from './laneMeta';
import {
  PERSONA_INK, RUNNER_INK,
  isLiveSession, processBuckets, processLanes, processTotal,
} from './farProcesses';
import { SleepingMark } from './SleepingMark';
import type { FleetNode, RunnerNode } from './types';

const R = FAR_RADIUS;
const PERIMETER = R * 6;

/** Row baselines. All three sit within |y| ≤ R/2, the band where a pointy-top
 *  hexagon keeps its full width — no row ever tapers into a corner. */
const ROW_Y = [-88, 0, 88];
const GLYPH_X = -136;
const GLYPH = 30;
const PIP_X0 = -94;
const PIP_STEP = 33;
const PIP_R = 13;
/** Pips shown before the numeral alone carries the excess — six keeps the last
 *  pip clear of the count column. The numeral is always the exact truth. */
const PIP_MAX = 6;
const COUNT_X = 148;
const COUNT_FS = 54;

interface Pip {
  ink: string;
  /** Outline-only — queued work that exists but has not started. */
  hollow?: boolean;
  /** Ring the pip — a session stopped for a human. */
  attention?: boolean;
}

const fleetOrder = (state: string): number => {
  const i = (FLEET_STATE_ORDER as readonly string[]).indexOf(state);
  return i === -1 ? 99 : i;
};

export function MidTallyBoard({ fleet, personas, runners }: {
  fleet: FleetNode[];
  personas: string[];
  runners: RunnerNode[];
}) {
  const { t } = useTranslation();
  const lanes = processLanes(fleet, personas, runners);
  const total = processTotal(processBuckets(fleet, personas, runners));

  if (total === 0) {
    return (
      <g data-testid="mm-mid-tally">
        <title>{`${t.mastermind.far_idle} — ${t.mastermind.far_idle_hint}`}</title>
        <polygon
          points={hexPoints(0, 0, R)}
          fill={mix('var(--secondary)', 45, 'var(--background)')}
          stroke={mix('var(--muted-foreground)', 34)}
          strokeWidth={R * 0.05}
          strokeDasharray={`${PERIMETER * 0.035} ${PERIMETER * 0.028}`}
          strokeLinejoin="round"
          opacity={0.75}
        />
        <SleepingMark x={-R * 0.34} y={-R * 0.34} width={R * 0.68} height={R * 0.68} strokeWidth={1.6} style={{ color: mix('var(--muted-foreground)', 62) }} />
      </g>
    );
  }

  // One pip per live process. Fleet sorts attention-first (the stuck pip leads
  // its row), runners running-first; both must reduce from the SAME sets the
  // lane counts use, or the pips would not sum to the numerals beside them.
  const pipsByLane: Pip[][] = [
    [...fleet].filter(isLiveSession)
      .sort((a, b) => fleetOrder(a.state) - fleetOrder(b.state))
      .map((f) => ({
        ink: FLEET_INK[f.state] ?? 'var(--status-neutral)',
        attention: f.state === 'awaiting_input' || f.state === 'stale',
      })),
    personas.map(() => ({ ink: PERSONA_INK })),
    [...runners]
      .sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1))
      .map((r) => ({ ink: RUNNER_INK, hollow: r.status !== 'running' })),
  ];

  return (
    <g data-testid="mm-mid-tally">
      {/* The vessel: the far hex, kept neutral — the pips carry the colour. */}
      <polygon
        points={hexPoints(0, 0, R)}
        fill={mix('var(--secondary)', 60, 'var(--background)')}
        stroke={mix('var(--muted-foreground)', 30)}
        strokeWidth={4}
        strokeLinejoin="round"
      />

      {lanes.map((lane, i) => {
        const y = ROW_Y[i]!;
        const empty = lane.count === 0;
        const Icon = LANE_ICON[lane.key];
        const pips = pipsByLane[i]!.slice(0, PIP_MAX);
        return (
          <g key={lane.key} data-testid={`mm-tally-row-${lane.key}`}>
            <title>{laneTip(t, lane)}</title>

            <g transform={`translate(${GLYPH_X} ${y})`} opacity={empty ? 0.35 : 0.9}>
              <Icon x={-GLYPH / 2} y={-GLYPH / 2} width={GLYPH} height={GLYPH} strokeWidth={1.6} style={{ color: empty ? 'var(--muted-foreground)' : lane.ink }} />
            </g>

            {empty ? (
              // An empty lane is drawn as an empty lane — a dashed rest line,
              // never an omitted row. "Nothing here" is a readable fact.
              <line
                x1={PIP_X0 - 6} y1={y} x2={COUNT_X - 40} y2={y}
                stroke={mix('var(--muted-foreground)', 30)}
                strokeWidth={2.5}
                strokeDasharray="9 8"
                data-testid={`mm-tally-empty-${lane.key}`}
              />
            ) : (
              pips.map((pip, k) => {
                const cx = PIP_X0 + k * PIP_STEP;
                return (
                  <g key={k} transform={`translate(${cx} ${y})`}>
                    {pip.attention && (
                      <circle r={PIP_R + 6} fill="none" stroke={mix(FLEET_INK.awaiting_input!, 70)} strokeWidth={3} data-testid="mm-tally-attn-pip" />
                    )}
                    <circle
                      r={PIP_R}
                      fill={pip.hollow ? 'none' : pip.ink}
                      stroke={pip.hollow ? pip.ink : mix('var(--background)', 45)}
                      strokeWidth={pip.hollow ? 3 : 1.5}
                      data-testid={`mm-tally-pip-${lane.key}`}
                    />
                  </g>
                );
              })
            )}

            <text
              x={COUNT_X} y={y + 19}
              textAnchor="end"
              fontSize={COUNT_FS}
              fontWeight={700}
              fontFamily={SERIF}
              fill={empty ? mix('var(--muted-foreground)', 60) : 'var(--foreground)'}
              style={{ fontVariantNumeric: 'tabular-nums' }}
              data-testid={empty ? undefined : `mm-tally-count-${lane.key}`}
            >
              {empty ? '–' : lane.count}
            </text>
          </g>
        );
      })}
    </g>
  );
}
