import type { KeyboardEvent } from 'react';

import { Ghost, KitButton } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../../model/types';
import { BRIEFING } from './copy';
import { HistoryTicks, Item, Tag } from './Item';
import type { ItemProps } from './itemTypes';
import { movementClause } from './movement';
import { Typer } from './Typer';

const I = BRIEFING.item;

/** Athena's directions as a numbered radio list; her pick is marked; click or 1-3 picks. */
function Options({ row, selected, editable, onPick }: { row: RowView; selected: boolean; editable: boolean; onPick: (i: number) => void }) {
  const { t } = useTranslation();
  const press = (i: number) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onPick(i);
  };
  return (
    <ol className="sb-opts" role="radiogroup" aria-label={t.athena.standup.cards.label}>
      {row.proposals.map((p, i) => (
        <li
          key={p.id}
          role="radio"
          aria-checked={i === row.chosenIndex}
          aria-disabled={!editable}
          tabIndex={editable && selected ? 0 : -1}
          className={`sb-opt focus-ring ${p.recommended ? 'is-pick' : ''}`}
          onClick={editable ? (e) => { e.stopPropagation(); onPick(i); } : undefined}
          onKeyDown={editable ? press(i) : undefined}
        >
          <span className="sb-opt__num typo-label">{i + 1}</span>
          <span className="sb-opt__text">
            <span className="typo-body text-foreground">{p.text}</span>
            {p.recommended && <span className="sb-opt__pick typo-label">{t.athena.standup.cards.recommended}</span>}
            {selected && p.rationale && <span className="sb-opt__why typo-caption">{p.rationale}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * An undecided project, open in the document: the margin carries its name and
 * history; the text column carries today's movement, Athena's read, the
 * numbered directions and, on the selected block, the quiet text actions.
 */
export function DirectionBlock({ entry, ctx }: ItemProps) {
  const { row, index } = entry;
  const { c, editable, proposing, api } = ctx;
  const selected = index === c.ui.sel;
  const typing = c.ui.typing === row.key;
  const hasProps = row.proposals.length > 0;
  return (
    <Item row={row} index={index} selected={selected} onSelect={c.select} className="sb-item--open">
      <div className="sb-margin">
        <h3 className="typo-title sb-name">{row.name}</h3>
        <HistoryTicks row={row} />
      </div>
      <div className="sb-text">
        <div className="sb-head">
          <span className="typo-caption">{movementClause(row)}</span>
          <Tag state={row.state} />
        </div>
        {row.evidence && <p className="typo-body text-foreground">{row.evidence}</p>}
        {hasProps && <Options row={row} selected={selected} editable={editable} onPick={(i) => c.pick(row, i)} />}
        {!hasProps && proposing && !row.evidence && <Ghost width="70%" height="1rem" />}
        {typing && <Typer row={row} onTyped={c.typed} />}
        {selected && editable && !typing && (
          <div className="sb-acts">
            <KitButton tone="quiet" hint="E" stopPropagation onClick={() => c.set({ typing: row.key })}>{hasProps ? I.type_own : I.type_blank}</KitButton>
            <KitButton tone="quiet" hint="S" stopPropagation onClick={() => api.setState(row, 'skipped')}>{I.skip}</KitButton>
            <KitButton tone="quiet" hint="T" stopPropagation onClick={() => api.talk(row)}>{I.talk}</KitButton>
            <KitButton tone="quiet" hint="↵" stopPropagation onClick={() => c.set({ dossier: true })}>{I.dossier}</KitButton>
          </div>
        )}
      </div>
    </Item>
  );
}
