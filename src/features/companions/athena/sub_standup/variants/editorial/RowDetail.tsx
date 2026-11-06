import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { RowView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { ChoiceList, GhostChoices } from './ChoiceList';
import { ED_COPY, fill } from './copy';
import type { RowActions } from './rowActions';

/** "Type your own": an underlined serif line. Enter decides, Escape cancels; the page keymap never sees these keys. */
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
      className={`${INPUT_FIELD} se-typer`}
      value={text}
      aria-label={label}
      placeholder={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
    />
  );
}

/** A quiet action set as text: its key in a hairline cap, the verb beside it. */
function Act({ k, onPress, children }: { k: string; onPress: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" className="se-act" icon={<Kbd>{k}</Kbd>} onClick={(e) => { e.stopPropagation(); onPress(); }}>
      {children}
    </Button>
  );
}

/** A label hung in the name column, right-aligned against the text it introduces. */
function Hang({ children }: { children?: ReactNode }) {
  return <div className="se-hang">{children && <span className="se-sc">{children}</span>}</div>;
}

interface Props {
  row: RowView;
  editable: boolean;
  typing: boolean;
  proposing: boolean;
  act: RowActions;
}

/** The selected row, opened across the page: hanging labels, Athena's read in the serif, the numbered choices, the actions. */
export function RowDetail({ row, editable, typing, proposing, act }: Props) {
  const d = ED_COPY.detail;
  const isDirection = row.kind === 'direction';
  const decided = row.state !== 'proposed' && row.state !== 'blank';
  const choices = isDirection && row.proposals.length > 0;
  return (
    <div className="se-detail">
      {(row.refusal || row.evidence) && (
        <>
          <Hang>{d.read}</Hang>
          <div className="se-measure"><p className="se-read">{row.refusal ?? row.evidence}</p></div>
        </>
      )}
      {(choices || (isDirection && proposing && !row.evidence)) && (
        <>
          <Hang>{editable && choices ? fill(d.keys, { n: row.proposals.length }) : d.directions}</Hang>
          <div className="se-measure">
            {choices ? <ChoiceList row={row} editable={editable} onPick={(i) => act.pick(row, i)} /> : <GhostChoices />}
          </div>
        </>
      )}
      {typing && (<><Hang /><div className="se-measure"><Typer row={row} onTyped={(text) => act.typed(row, text)} /></div></>)}
      <Hang />
      <div className="se-measure se-acts">
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
