// The row's two drawn cells: a strand per seat (the track is the time limit,
// the fill is elapsed) and a still per variant in its tray colour. Both are
// figures rather than structure - free inside the row's grid cell, tokenised
// for type and colour (doctrine 6c).
import { X } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { bucketLabel, type ContestStrings } from '../model/labels';
import { ceilingS, microGroups, microSize, seatElapsedS, strandFraction, strandKind, variantName } from './ledgerModel';
import { plainStateLabel } from './ledgerLabels';
import { bucketColor, cssVars, formatDuration, formatUsd, Seat, seatColor, Still } from './parts';

export function Strands({ summary, nowMs, s }: { summary: ContestSummary; nowMs: number; s: ContestStrings }) {
  const seats = summary.ledger.seats;
  const ceiling = ceilingS(summary.ledger);
  const gap = seats.length <= 2 ? 10 : seats.length === 3 ? 7 : 4;
  return (
    <div className="c-run" role="gridcell" style={cssVars({ '--strand-gap': `${gap}px` })}>
      {seats.map((seat) => {
        const kind = strandKind(seat.state);
        const frac = strandFraction(seat, ceiling, nowMs);
        return (
          <Tooltip key={seat.seatId} content={<SeatTip seat={seat} ceiling={ceiling} nowMs={nowMs} s={s} />} placement="top">
            <div className={`strand ${kind}`} style={cssVars({ '--t': seatColor(seat.state) })} data-testid={`ledger-strand-${seat.seatId}`}>
              <i className="edot" style={{ background: engineOf(seat.spec) }} aria-hidden />
              <div className="track">
                {kind === 'queued' ? (
                  <i className="tick" />
                ) : (
                  <div className="fill" style={{ width: `${(frac * 100).toFixed(2)}%` }} />
                )}
                {kind === 'out' && (
                  <span className="xend" style={{ left: `${(frac * 100).toFixed(2)}%` }}>
                    <X className="w-[11px] h-[11px]" aria-hidden />
                  </span>
                )}
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function engineOf(spec: string): string {
  const engine = spec.split(':', 1)[0];
  return engine === 'claude' ? 'var(--brand-purple)' : engine === 'codex' ? 'var(--brand-cyan)' : engine === 'grok' ? 'var(--foreground)' : 'var(--muted)';
}

function SeatTip({ seat, ceiling, nowMs, s }: { seat: ContestSeat; ceiling: number | null; nowMs: number; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const ran = seat.state !== 'queued' && seat.state !== 'idle';
  return (
    <div className="contest-ledger space-y-1" data-type-density="compact">
      <Seat spec={seat.spec} />
      <div className="flex justify-between gap-4">
        <span>{L.tip_state}</span>
        <b style={{ color: seatColor(seat.state) }}>{plainStateLabel(L, seat.state)}</b>
      </div>
      <div className="flex justify-between gap-4">
        <span>{L.tip_elapsed}</span>
        <b>{tx(L.tip_elapsed_value, { elapsed: formatDuration(seatElapsedS(seat, nowMs)), limit: formatDuration(ceiling, false) })}</b>
      </div>
      <div className="flex justify-between gap-4">
        <span>{L.tip_cost}</span>
        <b>{seat.costUsd !== null && ran ? formatUsd(seat.costUsd) : L.tip_not_reported}</b>
      </div>
      {seat.errors[0] && <div className="text-status-error">{seat.errors[0]}</div>}
    </div>
  );
}

export function MicroStills({ summary, wide, s }: { summary: ContestSummary; wide: boolean; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const groups = microGroups(summary);
  const size = microSize(groups, wide ? 380 : 234, wide ? 58 : 40);
  return (
    <div className="c-vars" role="gridcell" style={cssVars({ '--mw': `${size.w}px`, '--mh': `${size.h}px` })}>
      {groups.map((g) => (
        <span key={g.seat.seatId} className="mg">
          {g.cells.map((c, i) =>
            c.kind === 'still' ? (
              <Tooltip
                key={c.variant.key}
                content={tx(L.tip_variant, { key: c.variant.key, name: variantName(c.variant), tray: c.bucket ? bucketLabel(s, c.bucket) : s.bucket_none })}
                placement="top"
              >
                <span className={`ms${c.bucket === 'winner' ? ' win' : ''}`} data-testid={`ledger-still-${c.variant.key}`}>
                  <Still src={c.variant.still} label="" />
                  {c.bucket && <i className="bb" style={cssVars({ '--b': bucketColor(c.bucket) })} />}
                </span>
              </Tooltip>
            ) : (
              <Tooltip
                key={`empty-${i}`}
                content={c.out ? tx(L.tip_out, { state: plainStateLabel(L, g.seat.state) }) : L.tip_not_delivered}
                placement="top"
              >
                <span className={`ms empty${c.out ? ' out' : ''}`} />
              </Tooltip>
            ),
          )}
        </span>
      ))}
    </div>
  );
}
