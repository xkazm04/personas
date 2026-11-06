import type { KeyboardEvent } from 'react';
import { Check, Sparkles } from 'lucide-react';

import { Ghost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../../model/types';
import { Key } from './controls';
import { STUDIO_COPY } from './copy';

/** While proposals stream in: three ghost tiles in the tiles' own geometry. */
export function GhostChoices() {
  return (
    <div className="ss-tiles" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="ss-tile is-ghost" aria-hidden="true">
          <span className="ss-tile__top"><span className="ss-tile__radio" /></span>
          <Ghost width={`${70 - i * 10}%`} height="0.9rem" />
          <Ghost width="90%" />
        </div>
      ))}
    </div>
  );
}

/**
 * Athena's directions as selectable option tiles (the radio-tile pattern):
 * number keycap, title (500), one evidence line (400), her pick as a sparkle
 * badge. The chosen tile takes the primary ring and a primary tint (DECIDED).
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
    <div className={`ss-tiles ${shown.length === 1 ? 'is-single' : ''}`} role="radiogroup" aria-label={t.athena.standup.cards.label}>
      {shown.map(({ p, i }) => {
        const chosen = i === row.chosenIndex;
        return (
          <div
            key={p.id}
            role="radio"
            aria-checked={chosen}
            aria-disabled={!editable}
            tabIndex={editable ? 0 : -1}
            className={`ss-tile focus-ring ${chosen ? 'is-chosen' : ''} ${editable ? 'is-live' : ''}`}
            onClick={editable ? (e) => { e.stopPropagation(); onPick(i); } : undefined}
            onKeyDown={editable ? press(i) : undefined}
          >
            <span className="ss-tile__top">
              <span className="ss-tile__radio" aria-hidden="true">{chosen && <Check strokeWidth={3} />}</span>
              {editable && <Key>{i + 1}</Key>}
              {p.recommended && (
                <span className="ss-sparkle"><Sparkles aria-hidden="true" />{STUDIO_COPY.detail.pick}</span>
              )}
            </span>
            <span className="ss-tile__title ss-clamp2">{p.text}</span>
            {p.rationale && <span className="ss-tile__ev ss-clamp2">{p.rationale}</span>}
          </div>
        );
      })}
    </div>
  );
}
