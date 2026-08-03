// Floating name banner — the readability workhorse. Rendered in world space
// but counter-scaled by 1/z, so it keeps a constant SCREEN size at every zoom
// (the Civilization city-label pattern). Round 3: the title grows as the
// camera pulls back (far > mid > near) so distant identity reads instantly.
import { useTranslation } from '@/i18n/useTranslation';

import { FLEET_INK, mix, SERIF, STATE_INK } from './ink';
import type { Island, ZoomBand } from './types';

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Screen-px title size per band — bigger when zoomed out, and (round 4)
 *  raised at near/close so the name stays commanding during inspection. */
const TITLE_FS: Record<ZoomBand, number> = { far: 20, mid: 18, near: 17, close: 16 };

export function IslandBanner({ island, z, band, topWorldY, handleProps, onContextMenu, onShipOpen }: {
  island: Island;
  z: number;
  band: ZoomBand;
  /** World-space Y of the banner anchor (above the island's visual top). */
  topWorldY: number;
  /** When set, the banner IS the island's move/select handle (edit mode):
   *  pointer handlers land on the pill, inner content stays transparent. */
  handleProps?: { handlers: Record<string, (e: React.PointerEvent<SVGGElement>) => void>; cursor: string };
  /** Right-click on the header — opens the dimension context menu. */
  onContextMenu?: (e: React.MouseEvent<SVGGElement>) => void;
  /** Ship chip clicked — deep-link into the project's Factory Ship tab.
   *  Absent → the chip renders inert (data still reads). */
  onShipOpen?: () => void;
}) {
  const { t, tx } = useTranslation();
  const ink = STATE_INK[island.state];
  const name = trunc(island.name, 26);
  const hasFlag = island.blockers > 0;
  const fs = TITLE_FS[band];
  const h = fs + 16;
  const metaW = (hasFlag ? 24 : 0) + 44;
  const w = Math.min(430, Math.max(150, name.length * fs * 0.58 + metaW + 62));
  const k = 1 / z;
  // Names the source of the island's colour (static readiness vs a live
  // monitoring signal), plus the attention state — a lightweight native tooltip.
  const stateLabel = island.stateSource === 'errors' ? t.mastermind.island_state_errors : t.mastermind.island_state_readiness;
  const title = island.attention ? `${stateLabel} · ${t.mastermind.attention_tooltip}` : stateLabel;
  return (
    <g transform={`translate(0 ${topWorldY}) scale(${k})`} pointerEvents={handleProps || onContextMenu ? undefined : 'none'}>
      <g
        transform={`translate(0 ${-h / 2 - 2})`}
        {...(handleProps?.handlers ?? {})}
        style={handleProps ? { cursor: handleProps.cursor } : undefined}
        onContextMenu={onContextMenu}
        data-testid={`mm-header-${island.slug}`}
      >
        <title>{title}</title>
        <rect
          x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2}
          fill={mix('var(--background)', 86)}
          stroke={mix(ink, 55)} strokeWidth={1.25}
        />
        {/* Attention ring around the identity dot — a static "needs you"
            marker (no idle animation). Constant screen size at every zoom. */}
        {island.attention && (
          <circle
            cx={-w / 2 + h / 2} r={fs * 0.58}
            fill="none" stroke={FLEET_INK.awaiting_input} strokeWidth={2}
            data-testid={`mm-attention-${island.slug}`}
          />
        )}
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

      {/* Ship milestone chip — dev status at first sight: the next milestone
          and shipped count from dev_milestones, floated above the name pill.
          Late forecast tints warning; everything-shipped tints success. */}
      {island.ship && (() => {
        const ship = island.ship;
        const chFs = 10.5;
        const chH = chFs + 9;
        const nextLabel = ship.next ? trunc(ship.next, 24) : t.ship.cover_all_shipped;
        const count = tx(t.ship.cover_shipped_count, { shipped: ship.shipped, total: ship.total });
        const chW = Math.min(340, nextLabel.length * chFs * 0.56 + count.length * chFs * 0.52 + 44);
        const chInk = ship.late ? 'var(--status-warning)' : ship.next ? 'var(--primary)' : 'var(--status-success)';
        return (
          <g
            transform={`translate(0 ${-h - chH / 2 - 8})`}
            {...(onShipOpen
              ? { onClick: (e: React.MouseEvent<SVGGElement>) => { e.stopPropagation(); onShipOpen(); }, onPointerDown: (e: React.PointerEvent<SVGGElement>) => e.stopPropagation(), style: { cursor: 'pointer' } as React.CSSProperties }
              : { pointerEvents: 'none' as const })}
            data-testid={`mm-ship-chip-${island.slug}`}
          >
            <title>{`${t.ship.cover_next}: ${nextLabel} · ${count}`}</title>
            <rect
              x={-chW / 2} y={-chH / 2} width={chW} height={chH} rx={chH / 2}
              fill={mix('var(--background)', 82)}
              stroke={mix(chInk, 50)} strokeWidth={1}
            />
            <circle cx={-chW / 2 + chH / 2} r={2.8} fill={chInk} />
            <text x={-chW / 2 + chH / 2 + 8} y={chFs * 0.35} fontSize={chFs} fontWeight={600} fill="var(--foreground)">
              {nextLabel}
            </text>
            <text x={chW / 2 - 9} y={chFs * 0.35} textAnchor="end" fontSize={9.5} fill={mix('var(--foreground)', 60)} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {count}
            </text>
          </g>
        );
      })()}
    </g>
  );
}
