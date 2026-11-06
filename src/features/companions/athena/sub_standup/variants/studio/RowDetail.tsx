import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BookOpen, Check, MessageCircle, MoonStar, PenLine, Undo2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { AthenaAvatar } from '../../../AthenaAvatar';
import type { RowView } from '../../model/types';
import { ChoiceList, GhostChoices } from './ChoiceList';
import { Btn, Key } from './controls';
import { STUDIO_COPY } from './copy';
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
    <label className="ss-typer">
      <PenLine className="ss-ico" aria-hidden="true" />
      <input
        ref={ref}
        className={`${INPUT_FIELD} ss-typer__input`}
        value={text}
        aria-label={label}
        placeholder={label}
        onClick={(e) => e.stopPropagation()}
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

/** The selected row's inset tray, under its own columns: Athena's read, the option tiles, then the row's actions. */
export function RowDetail({ row, editable, typing, proposing, act }: Props) {
  const d = STUDIO_COPY.detail;
  const isDirection = row.kind === 'direction';
  const decided = row.state !== 'proposed' && row.state !== 'blank';
  const press = (fn: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); fn(); };
  return (
    <div className="ss-detail">
      {(row.refusal || row.evidence) && (
        <p className="ss-read">
          <AthenaAvatar state="idle" size={20} />
          <span className="ss-read__who">{d.read}</span>
          <span className="ss-read__text">{row.refusal ?? row.evidence}</span>
        </p>
      )}
      {isDirection && row.proposals.length > 0 && <ChoiceList row={row} editable={editable} onPick={(i) => act.pick(row, i)} />}
      {isDirection && row.proposals.length === 0 && proposing && !row.evidence && <GhostChoices />}
      {typing && <Typer row={row} onTyped={(text) => act.typed(row, text)} />}
      <div className="ss-acts">
        {editable && row.kind === 'agent' && <Btn k="1" icon={<Check className="ss-ico" />} onClick={press(() => act.accept(row))}>{d.accept}</Btn>}
        {editable && isDirection && <Btn variant="quiet" k="E" icon={<PenLine className="ss-ico" />} onClick={press(() => act.edit(row))}>{decided ? d.edit : d.type}</Btn>}
        {editable && row.kind !== 'hold' && row.state !== 'refused' && <Btn variant="quiet" k="S" icon={<MoonStar className="ss-ico" />} onClick={press(() => act.skip(row))}>{d.skip}</Btn>}
        {row.itemId && row.state !== 'refused' && <Btn variant="quiet" k="T" icon={<MessageCircle className="ss-ico" />} onClick={press(() => act.talk(row))}>{row.kind === 'hold' ? d.answer : d.talk}</Btn>}
        <Btn variant="quiet" k="↵" icon={<BookOpen className="ss-ico" />} onClick={press(act.dossier)}>{d.dossier}</Btn>
        {editable && decided && row.kind !== 'hold' && row.state !== 'refused' && <Btn variant="quiet" k="⌫" icon={<Undo2 className="ss-ico" />} onClick={press(() => act.undo(row))}>{d.undo}</Btn>}
      </div>
    </div>
  );
}
