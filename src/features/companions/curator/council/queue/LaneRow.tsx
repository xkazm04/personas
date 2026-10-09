// One council in its lane: the title (large, never truncated) over its
// round and what it still has to fix, one heat cell per member on the shared
// columns, and the overall figure coloured by its distance to the bar. A
// lite-only council wears a dashed "lite" mark and a dashed overall:
// readable, not decidable.
import { memo, type KeyboardEvent } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { useMemberName } from '../verdict/marks';
import { cellKind, HeatCell } from './HeatCell';
import { overallTone, type LaneRow as LaneRowModel } from './laneModel';

export const LaneRow = memo(function LaneRow({
  row,
  members,
  selected,
  focusable,
  onSelect,
  onOpen,
  onKeyDown,
}: {
  row: LaneRowModel;
  members: string[];
  selected: boolean;
  /** The one row of the list that takes Tab (roving tab stop). */
  focusable: boolean;
  onSelect: (subject: CouncilSubjectState) => void;
  onOpen: (subject: CouncilSubjectState) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>, row: LaneRowModel) => void;
}) {
  const { t, tx, language } = useTranslation();
  const w = t.council.lanes;
  const memberName = useMemberName();
  const s = row.subject;
  const num = (v: number) => formatCount(v, { precision: 2, language });
  const tone = s.overall == null ? null : overallTone(s.overall, row.rubric.threshold);
  const markOf = (m: string) => row.marks.find((x) => x.name === m);
  const memberText = members
    .map((m) => {
      const mark = markOf(m);
      if (!mark) return null;
      if (mark.score == null) return `${memberName(m)} ${w.not_measured}`;
      return `${memberName(m)} ${num(mark.score)}${mark.floorHit ? `, ${w.below_floor}` : ''}`;
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
      aria-label={tx(w.row_label, {
        title: s.title,
        overall: s.overall == null ? w.not_measured : num(s.overall),
        members: memberText,
      })}
      onClick={() => onSelect(s)}
      onDoubleClick={() => onOpen(s)}
      onKeyDown={(e) => onKeyDown(e, row)}
    >
      <span className="ln-name">
        <span className="ln-title typo-heading">{s.title}</span>
        <span className="ln-meta typo-body">
          {s.roundNo != null && <span>{tx(w.round, { n: s.roundNo })}</span>}
          {row.liteOnly && <span className="ln-lite">{w.lite}</span>}
          {row.mustAddress > 0 && <span className="text-status-warning">{tx(w.to_fix, { n: row.mustAddress })}</span>}
          {s.hardFailures > 0 && (
            <span className="text-status-error">
              {tx(s.hardFailures === 1 ? w.hard_one : w.hard_other, { n: s.hardFailures })}
            </span>
          )}
        </span>
      </span>
      {members.map((m) => {
        const mark = markOf(m);
        return <HeatCell key={m} kind={cellKind(mark)} score={mark?.score ?? null} floorHit={mark?.floorHit ?? false} />;
      })}
      {s.overall == null ? (
        <span className="ln-overall typo-body text-muted">{w.not_measured}</span>
      ) : (
        <b className={`ln-overall typo-heading font-data is-${tone}`}>{num(s.overall)}</b>
      )}
    </div>
  );
});

export default LaneRow;
