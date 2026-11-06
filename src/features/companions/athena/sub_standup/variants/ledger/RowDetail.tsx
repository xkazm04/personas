import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { RowView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { ChoiceList, GhostChoices } from './ChoiceList';
import { LEDGER_COPY } from './copy';
import type { RowActions } from './rowActions';

/** "Type your own": Enter decides, Escape cancels; the page keymap never sees these keys. */
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
    <input
      ref={ref}
      className={`${INPUT_FIELD} sl-typer`}
      value={text}
      aria-label={label}
      placeholder={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
    />
  );
}

/** A quiet action: ghost button, its key as the icon. */
function Act({ k, onPress, children }: { k: string; onPress: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" icon={<Kbd>{k}</Kbd>} onClick={(e) => { e.stopPropagation(); onPress(); }}>
      {children}
    </Button>
  );
}

interface Props {
  row: RowView;
  editable: boolean;
  typing: boolean;
  proposing: boolean;
  act: RowActions;
}

/** The selected row, opened under its own columns: Athena's read, the choice list, then quiet actions. */
export function RowDetail({ row, editable, typing, proposing, act }: Props) {
  const d = LEDGER_COPY.detail;
  const isDirection = row.kind === 'direction';
  const decided = row.state !== 'proposed' && row.state !== 'blank';
  return (
    <div className="sl-detail">
      {(row.refusal || row.evidence) && (
        <p className="typo-body text-foreground sl-read">{row.refusal ?? row.evidence}</p>
      )}
      {isDirection && row.proposals.length > 0 && <ChoiceList row={row} editable={editable} onPick={(i) => act.pick(row, i)} />}
      {isDirection && row.proposals.length === 0 && proposing && !row.evidence && <GhostChoices />}
      {typing && <Typer row={row} onTyped={(text) => act.typed(row, text)} />}
      <div className="sl-acts">
        {editable && row.kind === 'agent' && <Act k="1" onPress={() => act.accept(row)}>{d.accept}</Act>}
        {editable && isDirection && <Act k="E" onPress={() => act.edit(row)}>{decided ? d.edit : d.type}</Act>}
        {editable && row.kind !== 'hold' && row.state !== 'refused' && <Act k="S" onPress={() => act.skip(row)}>{d.skip}</Act>}
        {row.itemId && row.state !== 'refused' && <Act k="T" onPress={() => act.talk(row)}>{row.kind === 'hold' ? d.answer : d.talk}</Act>}
        <Act k="↵" onPress={act.dossier}>{d.dossier}</Act>
        {editable && decided && row.kind !== 'hold' && row.state !== 'refused' && <Act k="⌫" onPress={() => act.undo(row)}>{d.undo}</Act>}
      </div>
    </div>
  );
}
