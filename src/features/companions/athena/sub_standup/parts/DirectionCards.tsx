import type { KeyboardEvent } from 'react';

import { Ghost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../model/types';
import { Kbd } from './Kbd';

/** While proposals stream in: three calm card ghosts in the cards' own geometry. */
export function GhostCards() {
  return (
    <div className="su-opts" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="su-opt is-ghost" aria-hidden="true">
          <Ghost width={`${62 - i * 8}%`} height="0.9rem" />
          <Ghost width="92%" />
          <Ghost width="70%" />
        </div>
      ))}
    </div>
  );
}

/**
 * Athena's 2-4 directions as a radio group: 1-4 on the keyboard (the page
 * keymap), click or Enter/Space on a focused card. A proposal is a dashed
 * card; the chosen one turns solid primary (DECIDED).
 */
export function DirectionCards({ row, editable, onPick }: { row: RowView; editable: boolean; onPick: (index: number) => void }) {
  const { t } = useTranslation();
  const s = t.athena.standup.cards;
  const press = (i: number) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onPick(i);
  };
  return (
    <div className="su-opts" role="radiogroup" aria-label={s.label}>
      {row.proposals.map((p, i) => {
        const chosen = i === row.chosenIndex;
        return (
          <div
            key={p.id}
            role="radio"
            aria-checked={chosen}
            aria-disabled={!editable}
            tabIndex={editable ? 0 : -1}
            className={`su-opt focus-ring ${chosen ? 'is-chosen' : ''}`}
            onClick={editable ? () => onPick(i) : undefined}
            onKeyDown={editable ? press(i) : undefined}
          >
            <span className="su-opt__key"><Kbd>{i + 1}</Kbd></span>
            <span className="typo-body k-strong text-foreground pr-8">{p.text}</span>
            <span className="typo-caption">{p.rationale}</span>
            {p.recommended && <span className="typo-label text-primary">{s.recommended}</span>}
          </div>
        );
      })}
    </div>
  );
}
