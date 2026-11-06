import type { KeyboardEvent } from 'react';

import { Ghost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { LEDGER_COPY } from './copy';

/** While proposals stream in: three ghost lines in the list's own geometry. */
export function GhostChoices() {
  return (
    <div className="sl-choices" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="sl-choice is-ghost" aria-hidden="true">
          <span className="sl-radio" />
          <span className="sl-choice__text"><Ghost width={`${60 - i * 10}%`} height="0.9rem" /><Ghost width="85%" /></span>
        </div>
      ))}
    </div>
  );
}

/**
 * Athena's directions as a compact radio list: number key, title, one evidence
 * line, her pick marked. A proposal's radio is a dashed amber ring; the chosen
 * one is solid primary (DECIDED). 1-4 on the keyboard, click or Space here.
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
    <div className="sl-choices" role="radiogroup" aria-label={t.athena.standup.cards.label}>
      {shown.map(({ p, i }) => {
        const chosen = i === row.chosenIndex;
        return (
          <div
            key={p.id}
            role="radio"
            aria-checked={chosen}
            aria-disabled={!editable}
            tabIndex={editable ? 0 : -1}
            className={`sl-choice focus-ring ${chosen ? 'is-chosen' : ''} ${editable ? 'is-live' : ''}`}
            onClick={editable ? (e) => { e.stopPropagation(); onPick(i); } : undefined}
            onKeyDown={editable ? press(i) : undefined}
          >
            <span className="sl-radio" aria-hidden="true" />
            <Kbd>{i + 1}</Kbd>
            <span className="sl-choice__text">
              <span className="typo-body k-strong text-foreground">{p.text}</span>
              {p.rationale && <span className="typo-caption sl-clamp1">{p.rationale}</span>}
            </span>
            {p.recommended && <span className="sl-pick typo-label text-primary">{LEDGER_COPY.detail.pick}</span>}
          </div>
        );
      })}
    </div>
  );
}
