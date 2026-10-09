// PROTOTYPE ROUND (spark council-readout), direction A. One account in the
// ledger: the title as the line's name (never truncated), the member bar
// under it, the facts that need a person's attention, and the overall as a
// large figure in the right-hand column, toned by its distance to the bar.
//
// The row is an `option` of the list's listbox: the listbox owns focus and
// the arrows, the option takes the pointer (click selects, double click opens).
import type { MouseEvent } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { StateChip } from '../../../bench/chips';
import { usePercent } from '../../../table/usePercent';
import type { PanelRow } from '../../protoModel';
import { DISTANCE_TEXT, distanceOf, IMPLIED_STATE, optionId, S } from './ledgerModel';
import { LedgerBreakdown } from './LedgerBreakdown';
import { MemberBar } from './MemberBar';
import type { QueueFilter } from '../../protoModel';

interface Props {
  row: PanelRow;
  filter: QueueFilter;
  selected: boolean;
  onSelect: (subject: CouncilSubjectState) => void;
  onOpen: (subject: CouncilSubjectState) => void;
}

export function LedgerRow({ row, filter, selected, onSelect, onOpen }: Props) {
  const { language } = useTranslation();
  const percent = usePercent();
  const s = row.subject;
  const threshold = row.rubric.threshold;
  const n = (v: number) => formatCount(v, { precision: 2, language });
  const distance = distanceOf(row);
  const margin = s.overall == null ? null : s.overall - threshold;

  const facts: Array<{ text: string; tone: string }> = [];
  if (row.mustAddress) facts.push({ text: tx(S.toAddress, { count: row.mustAddress }), tone: 'text-foreground warn' });
  if (s.floorHits) facts.push({ text: s.floorHits === 1 ? S.floorHit : tx(S.floorHits, { count: s.floorHits }), tone: 'text-status-error err' });
  if (s.hardFailures) facts.push({ text: tx(S.hardFailures, { count: s.hardFailures }), tone: 'text-status-error err' });

  const click = (e: MouseEvent) => {
    // The second press of a double click is the open, not a second toggle.
    if (e.detail > 1) return;
    onSelect(s);
  };

  return (
    <li
      id={optionId(s.id)}
      role="option"
      aria-selected={selected}
      aria-label={tx(S.rowLabel, {
        title: s.title,
        project: s.projectName,
        overall: s.overall == null ? S.noOverall : n(s.overall),
        threshold: n(threshold),
      })}
      className={`lg-row${selected ? ' on' : ''}${row.liteOnly ? ' lite' : ''}`}
      onClick={click}
      onDoubleClick={() => onOpen(s)}
    >
      <h3 className={`m-0 typo-title-lg lg-title ${selected ? 'text-primary' : 'text-foreground'}`}>{s.title}</h3>
      <span className={`typo-data-lg lg-fig ${DISTANCE_TEXT[distance]}`}>{s.overall == null ? '-' : n(s.overall)}</span>
      <MemberBar
        seats={row.seats}
        members={Object.keys(row.rubric.dimensions).length}
        threshold={threshold}
        coverage={s.coverage}
        lite={row.liteOnly}
      />
      <span className="typo-label text-muted lg-margin">
        {margin == null ? S.noOverall : tx(margin < 0 ? S.under : S.over, { margin: n(Math.abs(margin)) })}
      </span>
      <div className="lg-meta typo-caption">
        <span>{s.projectName}</span>
        <span className="lg-dot" aria-hidden="true" />
        <span>{tx(S.round, { round: s.roundNo ?? 1 })}</span>
        {row.liteOnly ? <span className="lg-lite typo-label">{S.lite}</span> : null}
        {facts.map((f) => (
          <span key={f.text} className={`lg-fact typo-label ${f.tone}`}>
            {f.text}
          </span>
        ))}
        {IMPLIED_STATE[filter] !== s.state ? <StateChip state={s.state} /> : null}
      </div>
      {selected && row.seats ? (
        <div className="lg-open">
          <LedgerBreakdown seats={row.seats} threshold={threshold} lite={row.liteOnly} />
          <p className="m-0 typo-caption">
            {s.coverage != null ? tx(S.measured, { percent: percent(s.coverage) }) : null}
            {row.liteOnly ? ` · ${S.liteNote}` : ''}
          </p>
        </div>
      ) : null}
    </li>
  );
}

export default LedgerRow;
