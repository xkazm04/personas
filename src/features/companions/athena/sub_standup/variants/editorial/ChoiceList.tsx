import type { KeyboardEvent } from 'react';

import { Ghost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../../model/types';
import { ED_COPY } from './copy';

/** While proposals stream in: three ghost entries in the list's own geometry. */
export function GhostChoices() {
  return (
    <ol className="se-choices" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="se-choice is-ghost" aria-hidden="true">
          <span className="se-choice__n">{i + 1}</span>
          <span className="se-choice__text"><Ghost width={`${60 - i * 10}%`} height="0.9rem" /><Ghost width="85%" /></span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Athena's directions as a numbered list: the hanging serif numeral is also the key (1-4), the
 * title set in the serif, one line of evidence in the sans, her pick as a marginal note. The
 * chosen entry carries a solid primary rule in the margin and a primary numeral (DECIDED).
 */
export function ChoiceList({ row, editable, onPick }: { row: RowView; editable: boolean; onPick: (index: number) => void }) {
  const { t } = useTranslation();
  const press = (i: number) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onPick(i);
  };
  // Once the plan runs the list is a record, not a choice: only the picked direction stays.
  const shown = row.proposals.map((p, i) => ({ p, i })).filter(({ i }) => editable || i === row.chosenIndex);
  if (shown.length === 0) return null;
  return (
    <ol className="se-choices" role="radiogroup" aria-label={t.athena.standup.cards.label}>
      {shown.map(({ p, i }) => {
        const chosen = i === row.chosenIndex;
        return (
          <li
            key={p.id}
            role="radio"
            aria-checked={chosen}
            aria-disabled={!editable}
            tabIndex={editable ? 0 : -1}
            className={`se-choice focus-ring ${chosen ? 'is-chosen' : ''} ${editable ? 'is-live' : ''}`}
            onClick={editable ? (e) => { e.stopPropagation(); onPick(i); } : undefined}
            onKeyDown={editable ? press(i) : undefined}
          >
            <span className="se-choice__n" aria-hidden="true">{i + 1}</span>
            <span className="se-choice__text">
              <span className="se-choice__title se-serif">{p.text}</span>
              {p.rationale && <span className="se-body se-clamp1">{p.rationale}</span>}
            </span>
            {p.recommended ? <span className="se-note">{ED_COPY.detail.pick}</span> : <span />}
          </li>
        );
      })}
    </ol>
  );
}
