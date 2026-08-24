// The island's delivery panel — what this project still has to ship.
//
// The banner chip above the island answers the portfolio question ("is this
// moving, and is it late") in one line, which is the right answer at far and
// mid zoom where the island is a token on a map. At NEAR and CLOSE the reader
// has deliberately travelled to one project, and the question changes: not "is
// it moving" but "what is left". A single milestone name cannot answer that.
//
// So this panel sits under the island at those two bands only, listing the next
// unshipped milestones in plan order — the cut one first, then what is queued
// behind it, capped at three. Clicking it opens that project's Ship tab.
//
// Counter-scaled by 1/z like the banner and the fleet badges, so it holds a
// constant SCREEN size while the world zooms underneath it.
import { useTranslation } from '@/i18n/useTranslation';

import { mix, SERIF } from './ink';
import type { IslandShip } from './types';

const PANEL_W = 208;
const ROW_H = 17;
const HEAD_H = 19;
const PAD = 7;

/** Longest step name before it is clipped. The panel width is fixed so the
 *  column stays legible; a milestone whose name needs more than this is
 *  readable in the Ship tab, which is one click away. */
const NAME_MAX = 26;
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function IslandShipPanel({ ship, z, yWorld, onOpenShip }: {
  ship: IslandShip;
  z: number;
  /** World-space Y anchor below everything else under the island. */
  yWorld: number;
  /** Opens the project's Ship tab. Absent → the panel renders inert. */
  onOpenShip?: () => void;
}) {
  const { t } = useTranslation();
  const steps = ship.upcoming ?? [];
  // Nothing left to ship is a real state and worth one line — "all shipped" is
  // information, and a panel that vanishes would read as missing data instead.
  const rows = steps.length;
  const h = HEAD_H + Math.max(rows, 1) * ROW_H + PAD;

  return (
    <g
      transform={`translate(0 ${yWorld}) scale(${1 / z})`}
      {...(onOpenShip
        ? {
          onClick: (e: React.MouseEvent<SVGGElement>) => { e.stopPropagation(); onOpenShip(); },
          onPointerDown: (e: React.PointerEvent<SVGGElement>) => e.stopPropagation(),
          style: { cursor: 'pointer' } as React.CSSProperties,
        }
        : { pointerEvents: 'none' as const })}
      data-testid="mm-ship-panel"
    >
      <rect
        x={-PANEL_W / 2} y={0} width={PANEL_W} height={h} rx={8}
        fill={mix('var(--background)', 88)}
        stroke={mix(ship.late ? 'var(--status-warning)' : 'var(--primary)', 34)}
        strokeWidth={1}
      />

      {/* Header: the count carries the progress, so the rows below can be pure
          names rather than repeating "2 of 5" on every line. */}
      <text
        x={-PANEL_W / 2 + PAD} y={13}
        fontSize={9.5} fontWeight={700} letterSpacing="0.09em"
        fontFamily={SERIF}
        fill={mix('var(--foreground)', 62)}
        style={{ textTransform: 'uppercase' }}
      >
        {t.mastermind.ship_panel_title}
      </text>
      <text
        x={PANEL_W / 2 - PAD} y={13} textAnchor="end"
        fontSize={9.5} fill={mix('var(--foreground)', 55)}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {ship.shipped}/{ship.total}
      </text>

      {rows === 0 ? (
        <text
          x={-PANEL_W / 2 + PAD} y={HEAD_H + 11}
          fontSize={10} fill={mix('var(--status-success)', 90)}
        >
          {t.ship.cover_all_shipped}
        </text>
      ) : (
        steps.map((st, i) => {
          // The CUT milestone is the one being executed against a frozen scope;
          // the others are queued. That difference is the whole reason to list
          // more than one, so it carries both the dot and the weight.
          const cut = st.status === 'active';
          const y = HEAD_H + i * ROW_H;
          return (
            <g key={`${st.name}:${i}`} transform={`translate(0 ${y})`}>
              <circle
                cx={-PANEL_W / 2 + PAD + 3} cy={8} r={cut ? 3 : 2.4}
                fill={cut ? (ship.late ? 'var(--status-warning)' : 'var(--primary)') : 'none'}
                stroke={cut ? 'none' : mix('var(--foreground)', 34)}
                strokeWidth={1.2}
              />
              <text
                x={-PANEL_W / 2 + PAD + 12} y={11.5}
                fontSize={10.5}
                fontWeight={cut ? 600 : 400}
                fill={mix('var(--foreground)', cut ? 92 : 66)}
              >
                {trunc(st.name, NAME_MAX)}
              </text>
            </g>
          );
        })
      )}
    </g>
  );
}
