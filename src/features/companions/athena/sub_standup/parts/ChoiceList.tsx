import type { KeyboardEvent } from 'react';

import { Ghost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../model/types';
import { Key } from './prims';
import { StateGlyph } from './StateMark';

/** While proposals stream in: three ghost lines in the palette's own geometry. */
export function GhostChoices() {
  return (
    <div className="sc-choices" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="sc-choice is-ghost" aria-hidden="true">
          <Key>{i + 1}</Key>
          <span className="sc-choice__text"><Ghost width={`${60 - i * 10}%`} height="0.9rem" /><Ghost width="85%" /></span>
        </div>
      ))}
    </div>
  );
}

/**
 * Athena's directions as a command palette: the number key in a mono keycap,
 * the title, one dimmed evidence line, her pick as a small accent tag. The
 * chosen row takes the solid accent rail and a filled keycap (DECIDED).
 * 1-4 on the keyboard, click or Space here.
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
    <div className="sc-choices" role="radiogroup" aria-label={t.athena.standup.cards.label}>
      {shown.map(({ p, i }) => {
        const chosen = i === row.chosenIndex;
        return (
          <div
            key={p.id}
            role="radio"
            aria-checked={chosen}
            aria-disabled={!editable}
            tabIndex={editable ? 0 : -1}
            className={`sc-choice ${chosen ? 'is-chosen' : ''} ${editable ? 'is-live' : ''}`}
            onClick={editable ? (e) => { e.stopPropagation(); onPick(i); } : undefined}
            onKeyDown={editable ? press(i) : undefined}
          >
            <Key solid={chosen}>{i + 1}</Key>
            <span className="sc-choice__text">
              <span className="sc-choice__title">{p.text}</span>
              {p.rationale && <span className="sc-choice__why sc-clamp1">{p.rationale}</span>}
            </span>
            <span className="sc-choice__tail">
              {p.recommended && <span className="sc-pick">{t.athena.standup.console.detail.pick}</span>}
              {chosen && <StateGlyph state="decided" />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
