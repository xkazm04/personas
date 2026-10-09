// PROTOTYPE ROUND (spark council-readout), direction B. One scorecard: the
// council's rose on the left (the whole round in one figure), its name in
// large type (never truncated), where and which round, and a verdict chip
// that carries the overall as a figure with the word for its distance to the
// bar. Selected, it grows in place - a larger rose, the council's one-line
// reading, and the figures a person decides from.
//
// A card is an `option` of the list's listbox: the listbox owns focus and the
// arrows, the card takes the pointer (click selects, double click opens).
import type { MouseEvent } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { StateChip } from '../../../bench/chips';
import type { PanelRow, QueueFilter } from '../../protoModel';
import { CardDetail } from './CardDetail';
import { CardRose } from './CardRose';
import { cardId, IMPLIED_STATE, S, VERDICT_TONE, verdictOf } from './cardsModel';

interface Props {
  row: PanelRow;
  filter: QueueFilter;
  selected: boolean;
  onSelect: (subject: CouncilSubjectState) => void;
  onOpen: (subject: CouncilSubjectState) => void;
}

const VERDICT_WORD = {
  clears: S.clears,
  near: S.near,
  under: S.under,
  floorHit: S.floorHit,
  noOverall: S.noOverall,
} as const;

export function ScoreCard({ row, filter, selected, onSelect, onOpen }: Props) {
  const { language } = useTranslation();
  const s = row.subject;
  const verdict = verdictOf(row);
  const overall = s.overall == null ? null : formatCount(s.overall, { precision: 2, language });

  const click = (e: MouseEvent) => {
    // The second press of a double click is the open, not a second toggle.
    if (e.detail > 1) return;
    onSelect(s);
  };

  return (
    <li
      id={cardId(s.id)}
      role="option"
      aria-selected={selected}
      aria-label={tx(S.cardLabel, { title: s.title, project: s.projectName, overall: overall ?? S.noOverall })}
      className={`sc-card${selected ? ' on' : ''}${row.liteOnly ? ' lite' : ''}`}
      onClick={click}
      onDoubleClick={() => onOpen(s)}
    >
      <CardRose seats={row.seats} threshold={row.rubric.threshold} size={selected ? 116 : 72} lite={row.liteOnly} />
      <div className="sc-body">
        <h3 className="m-0 typo-title-lg sc-title">{s.title}</h3>
        <span className="typo-caption sc-meta">
          <span>{s.projectName}</span>
          <i aria-hidden="true" className="sc-dot" />
          <span>{tx(S.round, { round: s.roundNo ?? 1 })}</span>
          {row.liteOnly ? <span className="sc-lite typo-label">{S.lite}</span> : null}
        </span>
        <span className="sc-chips">
          <span className={`${VERDICT_TONE[verdict]} typo-label`}>
            <i aria-hidden="true" />
            {overall ? <b className="typo-data">{overall}</b> : null}
            {VERDICT_WORD[verdict]}
          </span>
          {IMPLIED_STATE[filter] !== s.state ? <StateChip state={s.state} /> : null}
        </span>
      </div>
      {selected && row.seats ? <CardDetail row={row} seats={row.seats} /> : null}
    </li>
  );
}

export default ScoreCard;
