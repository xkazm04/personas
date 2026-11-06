import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { GhostCards } from '../../parts/DirectionCards';
import { Kbd } from '../../parts/Kbd';
import type { RowView } from '../../model/types';
import { ChoiceCards, OwnDirection } from './ChoiceCards';
import { FOCUS_COPY as F } from './copy';
import type { RowActions } from './useRowActions';

/** "Type your own", inline: Enter decides, Escape cancels; the page keymap never sees these keys. */
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
    <div className="sf-typer">
      <input ref={ref} className={INPUT_FIELD} value={text} aria-label={label} placeholder={label} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <span className="typo-caption">{F.typing_hint}</span>
    </div>
  );
}

/** The presses under the decision, each naming its key; the line's quiet tools close the row. */
function ActRow({ row, a, editable, tools }: { row: RowView; a: RowActions; editable: boolean; tools: ReactNode }) {
  const open = row.state === 'proposed' || row.state === 'blank';
  return (
    <div className="sf-acts">
      {editable && (
        <>
          <Button variant="secondary" size="sm" icon={<Kbd>E</Kbd>} onClick={() => a.type(row)}>
            {row.proposals.length === 0 && open ? F.type_now : open ? F.type_own : F.edit_own}
          </Button>
          {row.state !== 'skipped' && <Button variant="ghost" size="sm" icon={<Kbd>S</Kbd>} onClick={() => a.skip(row)}>{F.skip}</Button>}
          {!open && <Button variant="ghost" size="sm" icon={<Kbd>⌫</Kbd>} onClick={() => a.undo(row)}>{F.undo}</Button>}
        </>
      )}
      <span className="sf-acts__tools">{tools}</span>
    </div>
  );
}

interface Props {
  row: RowView;
  editable: boolean;
  typing: boolean;
  proposing: boolean;
  a: RowActions;
  /** Talk it through / dossier, closing the action row. */
  tools: ReactNode;
}

/**
 * A project's decision: an own direction first when one was typed, then
 * Athena's options, then type-your-own / skip / undo. Skipped and
 * left-open-at-arming lines say so in one sentence instead of a card.
 */
export function DirectionDecision({ row, editable, typing, proposing, a, tools }: Props) {
  const typed = row.chosenIndex < 0 && row.headline !== '' && row.state !== 'proposed' && row.state !== 'skipped';
  return (
    <div className="sf-decision">
      {row.state === 'skipped' && <p className="sf-note typo-body text-foreground">{F.skipped_note}</p>}
      {!editable && (row.state === 'proposed' || row.state === 'blank') && <p className="sf-note typo-body text-foreground">{F.off_after_arm}</p>}
      {typed && <OwnDirection row={row} />}
      {row.proposals.length > 0 && (editable || row.chosenIndex >= 0) && <ChoiceCards row={row} editable={editable} only={!editable} onPick={(i) => a.pick(row, i)} />}
      {row.proposals.length === 0 && proposing && !row.evidence && <GhostCards />}
      {row.proposals.length === 0 && !typed && !typing && editable && !row.evidence && !proposing && <p className="typo-body text-foreground">{F.blank_lead}</p>}
      {typing && <Typer row={row} onTyped={(text) => a.typed(row, text)} />}
      {!typing && <ActRow row={row} a={a} editable={editable} tools={tools} />}
    </div>
  );
}
