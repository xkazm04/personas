// PROTOTYPE ROUND (spark council-readout), direction D. One council in its
// lane: the title (large, never truncated) over its round and what it still
// has to fix, one heat cell per member on the shared columns, and the
// overall figure coloured by its distance to the bar. A lite-only council
// wears a dashed "lite" mark and a dashed overall: readable, not decidable.
import { memo, type KeyboardEvent } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import type { PanelRow } from '../../protoModel';
import { cellKind, HeatCell } from './HeatCell';
import { memberName, overallTone } from './laneModel';

const S = {
  round: 'round {n}',
  lite: 'lite',
  toFix: '{n} to fix',
  hard: '{n} hard failure',
  notMeasured: 'not measured',
  unmeasured: 'not measured',
  floor: 'below its floor',
  label: '{title}. Overall {overall}. {members}',
};

export const LaneRow = memo(function LaneRow({
  row,
  members,
  selected,
  focusable,
  onSelect,
  onOpen,
  onKeyDown,
}: {
  row: PanelRow;
  members: string[];
  selected: boolean;
  /** The one row of the list that takes Tab (roving tab stop). */
  focusable: boolean;
  onSelect: (subject: CouncilSubjectState) => void;
  onOpen: (subject: CouncilSubjectState) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>, row: PanelRow) => void;
}) {
  const { language } = useTranslation();
  const s = row.subject;
  const num = (v: number) => formatCount(v, { precision: 2, language });
  const tone = s.overall == null ? null : overallTone(s.overall, row.rubric.threshold);
  const seatOf = (m: string) => row.seats?.find((x) => x.name === m);
  const memberText = members
    .map((m) => {
      const seat = seatOf(m);
      if (!seat) return null;
      if (seat.score == null) return `${memberName(m)} ${S.unmeasured}`;
      return `${memberName(m)} ${num(seat.score)}${seat.floorHit ? `, ${S.floor}` : ''}`;
    })
    .filter(Boolean)
    .join('; ');

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      data-id={s.id}
      className={`ln-row${selected ? ' is-on' : ''}${row.liteOnly ? ' is-lite' : ''}`}
      aria-label={tx(S.label, {
        title: s.title,
        overall: s.overall == null ? S.notMeasured : num(s.overall),
        members: memberText,
      })}
      onClick={() => onSelect(s)}
      onDoubleClick={() => onOpen(s)}
      onKeyDown={(e) => onKeyDown(e, row)}
    >
      <span className="ln-name">
        <span className="ln-title typo-heading">{s.title}</span>
        <span className="ln-meta typo-body">
          {s.roundNo != null && <span>{tx(S.round, { n: s.roundNo })}</span>}
          {row.liteOnly && <span className="ln-lite">{S.lite}</span>}
          {row.mustAddress != null && row.mustAddress > 0 && (
            <span className="text-status-warning">{tx(S.toFix, { n: row.mustAddress })}</span>
          )}
          {s.hardFailures > 0 && <span className="text-status-error">{tx(S.hard, { n: s.hardFailures })}</span>}
        </span>
      </span>
      {members.map((m) => {
        const seat = seatOf(m);
        return (
          <HeatCell
            key={m}
            kind={row.seats ? cellKind(seat) : 'ghost'}
            score={seat?.score ?? null}
            floorHit={seat?.floorHit ?? false}
          />
        );
      })}
      {s.overall == null ? (
        <span className="ln-overall typo-body text-muted">{S.notMeasured}</span>
      ) : (
        <b className={`ln-overall typo-heading font-data is-${tone}`}>{num(s.overall)}</b>
      )}
    </div>
  );
});

export default LaneRow;
