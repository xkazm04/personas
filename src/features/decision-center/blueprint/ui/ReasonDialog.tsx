import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { useSheet } from '../controller/SheetContext';
import { deltaText } from './format';
import { Keycap } from './Keycap';
import { LensGlyphIcon } from './LensGlyphIcon';

/**
 * The decline reason (X): the item's card, one labelled field, and a live preview of the exact call that will be
 * made (`decide`, the id, the decision and the note). Enter sends it, Esc cancels. The reason is kept by the store
 * as the item's decision note, so the next person can act on it.
 */
export function ReasonDialog({ itemId }: { itemId: string }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const p = s.work.byId.get(itemId);
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const id = requestAnimationFrame(() => input.current?.focus()); return () => cancelAnimationFrame(id); }, []);
  if (!p) return null;
  const L = s.plan.LENS[p.lens];
  const close = () => { s.dispatch({ type: 'overlay', overlay: null }); s.dispatch({ type: 'say', text: B.say_cancelled }); };
  const send = () => { void s.writes.decline(p, note.trim() || B.no_reason); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); send(); }
  };
  const preview = `decide(["${p.id}"], "decline", ${JSON.stringify(note.trim() || B.no_reason)})`;
  return (
    <ModalShell
      isOpen
      portal
      onClose={close}
      titleId="bp-reason-title"
      width="md"
      title={B.reason_question}
      subtitle={tx(B.reason_for, { lens: L?.name ?? p.lens })}
      footer={<div className="bp-dlg-foot typo-body"><span><Keycap k="Enter" /> {B.hint_send}</span><span><Keycap k="Escape" /> {B.hint_cancel}</span></div>}
    >
      <div className="bp-ctx">
        <span className="bp-g"><LensGlyphIcon glyph={L?.glyph ?? null} /></span>
        <span>
          <b className="typo-body">{p.title}</b>
          <span className="typo-code">{p.f.name} {'·'} {tx(B.size_risk, { size: p.size, risk: p.risk ?? '-' })} {'·'} {deltaText(s.plan, p, language)}</span>
        </span>
      </div>
      <label className="typo-eyebrow bp-dlg-l" htmlFor="bp-reason-input">{B.reason_label}</label>
      <input id="bp-reason-input" ref={input} className="bp-input typo-body" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onKey} placeholder={B.reason_placeholder} autoComplete="off" data-testid="blueprint-reason-input" />
      <div className="bp-dlg-cmd typo-code" data-testid="blueprint-reason-preview"><span className="typo-eyebrow">{B.reason_preview}</span> {preview}</div>
    </ModalShell>
  );
}
