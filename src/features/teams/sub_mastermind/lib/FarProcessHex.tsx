// The far-zoom island body: ONE large hex that answers "is anything happening
// here?" and nothing else.
//
// Far used to share the mid band's four category hexes, which was the wrong
// content twice over. At that distance four same-sized cells are four dots you
// cannot read, and readiness/wiring — what those cells encode — is an
// inspection question, not an orbital one. From orbit the operator is scanning
// a portfolio for *activity*, so this band shows exactly that:
//
//   idle    → the hex is quiet and carries a sleeping mark
//   active  → the hex is filled by the COUNT of live processes behind it
//
// and the hex's own border carries the breakdown: each process bucket (Fleet
// sessions by session state, plus the persona lane) owns an arc of the
// perimeter proportional to its share, in that bucket's own ink. So the number
// says how much, the border says of what kind and in what state, and neither
// needs a label the band has no room for.
//
// Readiness has not gone anywhere: the island's state halo sits behind this hex
// and still carries it as colour.
import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';

import { fleetStateLabel } from './fleetMeta';
import { hexPoints } from './hex';
import { FLEET_INK, mix, SERIF } from './ink';
import { processBuckets, processTotal, type ProcessBucket } from './farProcesses';
import { SleepingMark } from './SleepingMark';
import type { FleetNode } from './types';

/** Circumradius, chosen to match the visual mass of the mid band's category
 *  quad so crossing the far↔mid threshold changes the CONTENT of the island,
 *  never its size — the same promise the lattice already makes to the banner,
 *  halo and stat columns. */
export const FAR_RADIUS = 196;

/** A regular hexagon's perimeter is 6× its circumradius (side === radius). */
const PERIMETER = FAR_RADIUS * 6;
/** Border weight in world units — ~2px on screen at the top of the far band. */
const BORDER_W = FAR_RADIUS * 0.075;
/** Blank arc between adjacent buckets, so two touching segments stay two. */
const SEG_GAP = PERIMETER * 0.014;
/** Floor for a segment, so a single session among fifty is still a visible arc
 *  rather than a rounding error. Buckets are a count, not a measurement — the
 *  border is there to say "these kinds are present", and a share too small to
 *  draw would say the opposite. */
const SEG_MIN = PERIMETER * 0.01;

/** Number size by digit count — "fills the hex" without ever touching a wall.
 *  A pointy-top hex is 1.73× its circumradius wide at the centre line, which is
 *  what the 2- and 3-digit steps are sized against. */
const numberSize = (digits: number) =>
  FAR_RADIUS * (digits <= 1 ? 1.15 : digits === 2 ? 0.92 : 0.62);

const bucketLabel = (t: Translations, tx: (s: string, v: Record<string, string | number>) => string, b: ProcessBucket) =>
  b.kind === 'persona'
    ? tx(b.count === 1 ? t.mastermind.far_personas_one : t.mastermind.far_personas_other, { count: b.count })
    : `${b.count} × ${fleetStateLabel(t, b.key)}`;

export function FarProcessHex({ fleet, personas, attention }: {
  fleet: FleetNode[];
  /** Names of personas with an execution in progress on this project's team. */
  personas: string[];
  /** A session here is awaiting input or has gone stale. */
  attention: boolean;
}) {
  const { t, tx } = useTranslation();
  const buckets = processBuckets(fleet, personas);
  const total = processTotal(buckets);
  const idle = total === 0;

  // The tooltip is the only place the breakdown can be read as words, so it
  // carries the full list — the border says which kinds are present, this says
  // how many of each.
  const tip = idle
    ? `${t.mastermind.far_idle} — ${t.mastermind.far_idle_hint}`
    : [
        tx(total === 1 ? t.mastermind.far_active_one : t.mastermind.far_active_other, { count: total }),
        ...buckets.map((b) => bucketLabel(t, tx, b)),
      ].join(' · ');

  // Body tint comes from the FIRST bucket, and the buckets are ordered
  // attention-first — so an island with one session awaiting input reads violet
  // even when nine others are quietly running.
  const lead = buckets[0]?.ink ?? 'var(--status-neutral)';
  const digits = String(total).length;

  // Hit-testable on purpose, with no handlers of its own. A `pointer-events:
  // none` group would have made the <title> below unreachable — the browser
  // only shows a native tooltip for an element it hit-tests — and that tooltip
  // is the ONLY place this band can spell the breakdown out in words. Every
  // gesture still belongs to the island: the events bubble to its root (hover
  // dimming, double-click to frame) and on to the canvas (pan), exactly as they
  // already do through the state halo behind this hex.
  return (
    <g data-testid="mm-far-hex">
      <title>{tip}</title>

      <polygon
        points={hexPoints(0, 0, FAR_RADIUS)}
        fill={idle
          ? mix('var(--secondary)', 45, 'var(--background)')
          : mix(lead, 18, 'var(--secondary)')}
        stroke={idle ? mix('var(--muted-foreground)', 34) : mix(lead, 26)}
        strokeWidth={BORDER_W}
        strokeDasharray={idle ? `${PERIMETER * 0.035} ${PERIMETER * 0.028}` : undefined}
        strokeLinejoin="round"
        opacity={idle ? 0.75 : 1}
      />

      {/* Border encoding: one arc per bucket, proportional to its share. Drawn
          as dashes on a copy of the same polygon, so every arc traces the exact
          hexagon edge instead of an approximation of it. */}
      {!idle && (() => {
        let walked = 0;
        return buckets.map((b) => {
          const share = (b.count / total) * PERIMETER;
          const len = Math.max(share - SEG_GAP, SEG_MIN);
          const start = walked + SEG_GAP / 2;
          walked += share;
          return (
            <polygon
              key={b.key}
              points={hexPoints(0, 0, FAR_RADIUS)}
              fill="none"
              stroke={b.ink}
              strokeWidth={BORDER_W}
              strokeDasharray={`${len} ${PERIMETER - len}`}
              strokeDashoffset={-start}
              strokeLinecap="butt"
              data-testid={`mm-far-seg-${b.key}`}
            />
          );
        });
      })()}

      {/* "Needs you" at portfolio distance. Static, not a pulse: the canvas
          already decided (IslandBanner) that an idle animation on every island
          is noise, and this band can show a hundred of them at once. */}
      {attention && (
        <polygon
          points={hexPoints(0, 0, FAR_RADIUS + BORDER_W * 1.6)}
          fill="none"
          stroke={mix(FLEET_INK.awaiting_input!, 55)}
          strokeWidth={BORDER_W * 0.5}
          strokeLinejoin="round"
          data-testid="mm-far-attention"
        />
      )}

      {idle ? (
        <SleepingMark
          x={-FAR_RADIUS * 0.46}
          y={-FAR_RADIUS * 0.46}
          width={FAR_RADIUS * 0.92}
          height={FAR_RADIUS * 0.92}
          strokeWidth={1.6}
          style={{ color: mix('var(--muted-foreground)', 62) }}
        />
      ) : (
        <text
          y={numberSize(digits) * 0.35}
          textAnchor="middle"
          fontSize={numberSize(digits)}
          fontWeight={700}
          fontFamily={SERIF}
          fill="var(--foreground)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
          data-testid="mm-far-count"
        >
          {total}
        </text>
      )}
    </g>
  );
}
