// MID VARIANT A (round 2) — "Facet".
//
// METAPHOR: the far band's hex does not crack apart or get replaced — it stays
// EXACTLY where it was and its interior resolves into three rhombic faces
// meeting at the centre, the classic isometric-cube reading a hexagon carries
// for free. Top face = Fleet, lower-left = Personas, lower-right = Runners.
// Zooming far→mid keeps one silhouette on screen; only the inside gains
// structure — which is what zooming is supposed to mean.
//
// Round-1 lessons built in structurally:
//   * ONE silhouette, FAR_RADIUS — nothing can collide with the banner (top
//     −234), badges (+236) or stat columns (±280), because nothing leaves the
//     hex the far band already proved fits between them.
//   * No text smaller than a count numeral. Mid spans z 0.20–0.50, so a
//     12-world-px label renders at 2–6 screen px — unreadable. Identity is
//     carried by fixed position + glyph + colour; words live in tooltips.
//   * Lane glyphs are wrapped in their own <g transform> and sized explicitly
//     (FleetShipIcon now forwards SVG props — the round-1 "icons everywhere"
//     bug was that it silently dropped them).
import { useTranslation } from '@/i18n/useTranslation';

import { FAR_RADIUS } from './FarProcessHex';
import { hexPoints } from './hex';
import { FLEET_INK, mix, SERIF } from './ink';
import { LANE_ICON, laneTip } from './laneMeta';
import { processBuckets, processLanes, processTotal, runnerProgress, type ProcessLane } from './farProcesses';
import { SleepingMark } from './SleepingMark';
import type { FleetNode, RunnerNode } from './types';

const R = FAR_RADIUS;
const PERIMETER = R * 6;
const W = 0.866 * R; // half-width of the hexagon (√3/2 · R)

// Pointy-top hex vertices (y-down screen space): 270° is the TOP vertex.
const V30 = { x: W, y: R * 0.5 };
const V90 = { x: 0, y: R };
const V150 = { x: -W, y: R * 0.5 };
const V210 = { x: -W, y: -R * 0.5 };
const V270 = { x: 0, y: -R };
const V330 = { x: W, y: -R * 0.5 };

const pt = (v: { x: number; y: number }) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`;

/** The three cube faces: each rhombus = centre + three hex vertices. `outer` is
 *  the polyline along the hexagon border that belongs to this face — the rim
 *  that carries the lane's ink, continuing far's border-as-lane-colour rule. */
const FACES = [
  { // Fleet — the top face; the interactive lane gets the crown position.
    points: `0,0 ${pt(V210)} ${pt(V270)} ${pt(V330)}`,
    outer: [V210, V270, V330],
    num: { x: 0, y: -74 },
    glyph: { x: 0, y: -148 },
  },
  { // Personas — lower-left face.
    points: `0,0 ${pt(V90)} ${pt(V150)} ${pt(V210)}`,
    outer: [V210, V150, V90],
    num: { x: -88, y: 86 },
    glyph: { x: -88, y: 2 },
  },
  { // Runners — lower-right face.
    points: `0,0 ${pt(V330)} ${pt(V30)} ${pt(V90)}`,
    outer: [V330, V30, V90],
    num: { x: 88, y: 86 },
    glyph: { x: 88, y: 2 },
  },
] as const;

const GLYPH = 34;
const NUM_FS = 64;

export function MidFacetCube({ fleet, personas, runners }: {
  fleet: FleetNode[];
  personas: string[];
  runners: RunnerNode[];
}) {
  const { t } = useTranslation();
  const lanes = processLanes(fleet, personas, runners);
  const total = processTotal(processBuckets(fleet, personas, runners));
  const progress = runnerProgress(runners);

  // Idle island at mid = the same sleeping read the far band established, one
  // step closer. Consistency across bands beats a novel empty state.
  if (total === 0) {
    return (
      <g data-testid="mm-mid-facet">
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

  return (
    <g data-testid="mm-mid-facet">
      {lanes.map((lane, i) => {
        const face = FACES[i]!;
        return (
          <Face
            key={lane.key}
            lane={lane}
            face={face}
            tip={laneTip(t, lane)}
            progress={lane.key === 'runner' ? progress : null}
          />
        );
      })}

      {/* Carved seams from centre to the three alternating vertices — what
          turns three tinted rhombi into one object with three faces. */}
      <path
        d={`M0 0 L${V90.x} ${V90.y} M0 0 L${V210.x} ${V210.y} M0 0 L${V330.x} ${V330.y}`}
        stroke={mix('var(--background)', 80)}
        strokeWidth={5}
        strokeLinecap="round"
        pointerEvents="none"
      />

      {/* One outline over everything so the silhouette stays crisp where dim
          empty faces meet the sea. */}
      <polygon points={hexPoints(0, 0, R)} fill="none" stroke={mix('var(--muted-foreground)', 24)} strokeWidth={3} strokeLinejoin="round" pointerEvents="none" />

      {/* The far band's number, held at the seam junction — proof to the eye
          that the three faces are that count, split. */}
      <g pointerEvents="none" data-testid="mm-facet-total">
        <circle r={31} fill={mix('var(--background)', 92)} stroke={mix('var(--foreground)', 22)} strokeWidth={2} />
        <text y={10} textAnchor="middle" fontSize={30} fontWeight={700} fontFamily={SERIF} fill="var(--foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total}
        </text>
      </g>
    </g>
  );
}

function Face({ lane, face, tip, progress }: {
  lane: ProcessLane;
  face: (typeof FACES)[number];
  tip: string;
  /** 0–1 fraction along this face's outer rim (runner lane only). */
  progress: number | null;
}) {
  const empty = lane.count === 0;
  const Icon = LANE_ICON[lane.key];
  const ink = empty ? 'var(--muted-foreground)' : lane.ink;
  const outerPts = face.outer.map(pt).join(' ');
  // Two hexagon sides per face; each side's length equals R.
  const rimLen = 2 * R;

  return (
    <g data-testid={`mm-facet-face-${lane.key}`}>
      <title>{tip}</title>
      <polygon
        points={face.points}
        fill={empty ? mix('var(--secondary)', 42, 'var(--background)') : mix(lane.ink, 17, 'var(--secondary)')}
        opacity={empty ? 0.7 : 1}
      />
      {/* Face rim on the hexagon border, in the lane's ink — far's border rule,
          now owned per-face. Muted when the lane is empty. */}
      <polyline
        points={outerPts}
        fill="none"
        stroke={empty ? mix('var(--muted-foreground)', 30) : mix(lane.ink, 60)}
        strokeWidth={6}
        strokeLinecap="round"
        pointerEvents="none"
      />
      {/* Runner progress fills the rim as the running tasks advance — the
          border-as-instrument idea, one lane down. */}
      {progress !== null && progress > 0 && (
        <polyline
          points={outerPts}
          fill="none"
          stroke={mix(lane.ink, 100)}
          strokeWidth={6}
          strokeDasharray={`${rimLen * Math.min(progress, 1)} ${rimLen}`}
          strokeLinecap="butt"
          pointerEvents="none"
          data-testid="mm-facet-progress"
        />
      )}
      {/* A stopped session waiting on a human: the fleet rim re-strokes in the
          awaiting ink, slightly outside the border. Static — no pulse. */}
      {lane.attention && (
        <g transform={`scale(${(R + 13) / R})`} pointerEvents="none" data-testid="mm-facet-attention">
          <polyline points={outerPts} fill="none" stroke={mix(FLEET_INK.awaiting_input!, 60)} strokeWidth={4.5} strokeLinecap="round" />
        </g>
      )}

      <g transform={`translate(${face.glyph.x} ${face.glyph.y})`} pointerEvents="none" opacity={empty ? 0.45 : 0.85}>
        <Icon x={-GLYPH / 2} y={-GLYPH / 2} width={GLYPH} height={GLYPH} strokeWidth={1.6} style={{ color: ink }} />
      </g>

      {empty ? (
        <text x={face.num.x} y={face.num.y} textAnchor="middle" fontSize={NUM_FS * 0.62} fontWeight={700} fontFamily={SERIF} fill={mix('var(--muted-foreground)', 65)} pointerEvents="none">
          –
        </text>
      ) : (
        <text
          x={face.num.x} y={face.num.y}
          textAnchor="middle"
          fontSize={NUM_FS}
          fontWeight={700}
          fontFamily={SERIF}
          fill="var(--foreground)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
          pointerEvents="none"
          data-testid={`mm-facet-count-${lane.key}`}
        >
          {lane.count}
        </text>
      )}
    </g>
  );
}
