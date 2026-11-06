import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { RowState, RowView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { StateChip } from '../../parts/StateChip';
import { FOCUS_COPY as F } from './copy';

/** DECIDED is solid primary, RUNNING hatched success, DONE a quiet success rule; an open option is a dashed amber outline. */
function toneClass(state: RowState): string {
  if (state === 'running') return 'is-running';
  if (state === 'done') return 'is-done';
  return 'is-decided';
}

function Card({ head, title, body, chosen, state, dim, onPress, label }: {
  head: ReactNode;
  title: string;
  body?: string;
  chosen: boolean;
  state: RowState;
  dim: boolean;
  onPress?: () => void;
  label?: string;
}) {
  const press = (e: KeyboardEvent) => {
    if (!onPress || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    onPress();
  };
  return (
    <div
      role="radio"
      aria-checked={chosen}
      aria-disabled={!onPress}
      aria-label={label}
      tabIndex={onPress ? 0 : -1}
      className={`sf-card ${chosen ? toneClass(state) : 'is-open'} ${dim ? 'is-dim' : ''} ${onPress ? 'is-pressable' : ''}`}
      onClick={onPress}
      onKeyDown={press}
    >
      <div className="sf-card__head">{head}</div>
      <p className="typo-body k-strong text-foreground">{title}</p>
      {body && <p className="typo-caption">{body}</p>}
    </div>
  );
}

/**
 * Athena's directions as one radio group of generous cards: the key that
 * picks it, her pick marked, the title in full and her reason under it. The
 * chosen card takes the row's own state treatment; the others step back.
 */
export function ChoiceCards({ row, editable, only, onPick }: { row: RowView; editable: boolean; only?: boolean; onPick: (i: number) => void }) {
  const { t } = useTranslation();
  const s = t.athena.standup.cards;
  // Picked, typed or skipped: the options that were not taken step back.
  const decided = row.chosenIndex >= 0 || (row.state !== 'proposed' && row.state !== 'blank');
  // Once armed, only the direction that runs is in front of you.
  const shown = only ? row.proposals.filter((_, i) => i === row.chosenIndex) : row.proposals;
  return (
    <div className="sf-cards" role="radiogroup" aria-label={s.label} style={{ '--n': shown.length } as CSSProperties}>
      {shown.map((p) => {
        const i = row.proposals.indexOf(p);
        const chosen = i === row.chosenIndex;
        return (
          <Card
            key={p.id}
            title={p.text}
            body={p.rationale}
            chosen={chosen}
            state={row.state}
            dim={decided && !chosen}
            onPress={editable ? () => onPick(i) : undefined}
            head={(
              <>
                <Kbd>{i + 1}</Kbd>
                {p.recommended && <span className="sf-pick typo-label text-primary"><Sparkles className="w-3.5 h-3.5" aria-hidden="true" />{s.recommended}</span>}
                {chosen && <StateChip row={row} />}
              </>
            )}
          />
        );
      })}
    </div>
  );
}

/** A direction the operator typed: one card in the chosen treatment, above Athena's options. */
export function OwnDirection({ row }: { row: RowView }) {
  return (
    <Card
      title={row.headline}
      chosen
      state={row.state}
      dim={false}
      head={<><span className="typo-label text-foreground">{F.your_direction}</span><StateChip row={row} /></>}
    />
  );
}
