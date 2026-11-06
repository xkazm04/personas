import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { INPUT_FIELD, MOTION } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../model/types';
import { DirectionCards, GhostCards } from './DirectionCards';
import { KeyAct } from './Kbd';

interface Props {
  row: RowView;
  open: boolean;
  editable: boolean;
  typing: boolean;
  proposing: boolean;
  onPick: (index: number) => void;
  onTyped: (text: string | null) => void;
}

/** "Type your own": Enter decides, Escape cancels; the page keymap never sees these keys. */
function Typer({ row, onTyped }: { row: RowView; onTyped: Props['onTyped'] }) {
  const { t, tx } = useTranslation();
  const [text, setText] = useState(row.state === 'decided' ? row.headline : '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onTyped(text); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onTyped(null); }
  };
  return (
    <input
      ref={ref}
      className={INPUT_FIELD}
      value={text}
      aria-label={tx(t.athena.standup.cards.type_placeholder, { name: row.name })}
      placeholder={tx(t.athena.standup.cards.type_placeholder, { name: row.name })}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
    />
  );
}

/** The selected row, opened: Athena's read, then what can be done here and the keys that do it. */
function Body({ row, editable, typing, proposing, onPick, onTyped }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const s = t.athena.standup.cards;
  const isDirection = row.kind === 'direction';
  return (
    <div className="su-exp__body">
      {row.refusal && <p className="typo-body text-foreground">{row.refusal}</p>}
      {row.evidence && <p className="typo-body text-foreground">{row.evidence}</p>}
      {row.ask && <p className="typo-caption">{row.ask.options.join(' · ')}</p>}
      {isDirection && row.proposals.length > 0 && <DirectionCards row={row} editable={editable} onPick={onPick} />}
      {isDirection && row.proposals.length === 0 && proposing && !row.evidence && <GhostCards />}
      {typing && <Typer row={row} onTyped={onTyped} />}
      <div className="su-acts">
        {editable && isDirection && row.proposals.length > 0 && <KeyAct k={`1-${row.proposals.length}`}>{s.act_pick}</KeyAct>}
        {editable && row.kind === 'agent' && <KeyAct k="1">{s.act_accept}</KeyAct>}
        {editable && row.kind !== 'agent' && <KeyAct k="E">{row.proposals.length > 0 ? s.act_edit : s.act_type}</KeyAct>}
        {editable && <KeyAct k="S">{s.act_skip}</KeyAct>}
        {row.itemId && row.state !== 'refused' && <KeyAct k="T">{row.kind === 'hold' ? s.act_answer : s.act_talk}</KeyAct>}
        <KeyAct k="↵">{s.act_dossier}</KeyAct>
        {editable && row.state !== 'proposed' && row.state !== 'blank' && <KeyAct k="⌫">{s.act_undo}</KeyAct>}
      </div>
    </div>
  );
}

/** Keeps a closing body mounted for one `normal` motion step, so it collapses instead of vanishing. */
function useLinger(open: boolean): boolean {
  const [lingering, setLingering] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setLingering(true);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), MOTION.duration.normal);
    return () => clearTimeout(timer);
  }, [lingering]);
  return open || lingering;
}

/**
 * The expanding part of a row. It opens and collapses through
 * `grid-template-rows` (0fr -> 1fr on the motion tokens), so one row moving
 * never measures or re-lays the others; the body is mounted only while open
 * (and for the collapse that follows).
 */
export function RowExpand({ open, ...rest }: Props) {
  const mounted = useLinger(open);
  return (
    <div className={`su-exp ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div>{mounted && <Body {...rest} />}</div>
    </div>
  );
}
