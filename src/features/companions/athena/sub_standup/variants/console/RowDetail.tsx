import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../../model/types';
import { ChoiceList, GhostChoices } from './ChoiceList';
import { CONSOLE_COPY } from './copy';
import { Key, Press } from './prims';
import type { RowActions } from './rowActions';

/** "Type your own" as a palette prompt line: Enter decides, Escape cancels; the page keymap never sees these keys. */
function Typer({ row, onTyped }: { row: RowView; onTyped: (text: string | null) => void }) {
  const { t, tx } = useTranslation();
  const [text, setText] = useState(row.state === 'decided' ? row.headline : '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onTyped(text); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onTyped(null); }
  };
  const label = tx(t.athena.standup.cards.type_placeholder, { name: row.name });
  return (
    <label className="sc-typer" onClick={(e) => e.stopPropagation()}>
      <span className="sc-typer__caret" aria-hidden="true">›</span>
      <input
        ref={ref}
        className="sc-typer__input"
        value={text}
        aria-label={label}
        placeholder={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <Key>↵</Key>
    </label>
  );
}

interface Props {
  row: RowView;
  editable: boolean;
  typing: boolean;
  proposing: boolean;
  act: RowActions;
}

/** The selected row, opened under its own columns: Athena's read, the palette, then the key-hinted presses. */
export function RowDetail({ row, editable, typing, proposing, act }: Props) {
  const d = CONSOLE_COPY.detail;
  const isDirection = row.kind === 'direction';
  const decided = row.state !== 'proposed' && row.state !== 'blank';
  return (
    <div className="sc-detail">
      {(row.refusal || row.evidence) && (
        <p className="sc-read"><span className="sc-micro">{d.read}</span>{row.refusal ?? row.evidence}</p>
      )}
      {isDirection && row.proposals.length > 0 && <ChoiceList row={row} editable={editable} onPick={(i) => act.pick(row, i)} />}
      {isDirection && row.proposals.length === 0 && proposing && !row.evidence && <GhostChoices />}
      {typing && <Typer row={row} onTyped={(text) => act.typed(row, text)} />}
      <div className="sc-acts">
        {editable && row.kind === 'agent' && <Press k="1" onClick={() => act.accept(row)}>{d.accept}</Press>}
        {editable && isDirection && <Press k="E" onClick={() => act.edit(row)}>{decided ? d.edit : d.type}</Press>}
        {editable && row.kind !== 'hold' && row.state !== 'refused' && <Press k="S" onClick={() => act.skip(row)}>{d.skip}</Press>}
        {row.itemId && row.state !== 'refused' && <Press k="T" onClick={() => act.talk(row)}>{row.kind === 'hold' ? d.answer : d.talk}</Press>}
        <Press k="↵" onClick={act.dossier}>{d.dossier}</Press>
        {editable && decided && row.kind !== 'hold' && row.state !== 'refused' && <Press k="⌫" onClick={() => act.undo(row)}>{d.undo}</Press>}
      </div>
    </div>
  );
}
