import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { useSheet } from '../controller/SheetContext';
import type { NoteMove } from '../state/uiState';
import { deltaText } from './format';
import { Keycap } from './Keycap';
import { LensGlyphIcon } from './LensGlyphIcon';

/**
 * The note prompt: the decline reason (X), and the note a triage asks (WP4b: R rework, S descope, Y on a failed build).
 * The item's card, one labelled field, and a live preview of the exact call that will be made (`decide` or `triage`,
 * the id, the decision and the note). Enter sends it, Esc cancels. A decline without words sends "no reason given"; a
 * triage sends exactly what was typed, and nothing when nothing was: the store has the last word, and a refusal (a
 * failed build accepted without a note: `note-required`) comes back in the dock console, never pre-empted here.
 */
export function ReasonDialog({ itemId, move }: { itemId: string; move: NoteMove }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const p = s.work.byId.get(itemId);
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const id = requestAnimationFrame(() => input.current?.focus()); return () => cancelAnimationFrame(id); }, []);
  if (!p) return null;
  const L = s.plan.LENS[p.lens];
  const decline = move === 'decline';
  const text = note.trim();
  const close = () => { s.dispatch({ type: 'overlay', overlay: null }); s.dispatch({ type: 'say', text: B.say_cancelled }); };
  const send = () => { if (decline) void s.writes.decline(p, text || B.no_reason); else void s.writes.triage(p, move, text || undefined); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); send(); }
  };
  const preview = decline
    ? `decide(["${p.id}"], "decline", ${JSON.stringify(text || B.no_reason)})`
    : `triage(["${p.id}"], "${move}"${text ? `, ${JSON.stringify(text)}` : ''})`;
  const title = { decline: B.reason_question, rework: B.note_q_rework, descope: B.note_q_descope, accept: B.note_q_accept }[move];
  return (
    <ModalShell
      isOpen
      portal
      onClose={close}
      titleId="bp-reason-title"
      width="md"
      title={title}
      subtitle={tx(decline ? B.reason_for : B.note_for, { lens: L?.name ?? p.lens })}
      footer={<div className="bp-dlg-foot typo-body"><span><Keycap k="Enter" /> {B.hint_send}</span><span><Keycap k="Escape" /> {B.hint_cancel}</span></div>}
    >
      <div className="bp-ctx">
        <span className="bp-g"><LensGlyphIcon glyph={L?.glyph ?? null} /></span>
        <span>
          <b className="typo-body">{p.title}</b>
          <span className="typo-code">{p.f.name} {'·'} {tx(B.size_risk, { size: p.size, risk: p.risk ?? '-' })} {'·'} {deltaText(s.plan, p, language)}</span>
        </span>
      </div>
      <label className="typo-eyebrow bp-dlg-l" htmlFor="bp-reason-input">{decline ? B.reason_label : B.note_label}</label>
      <input id="bp-reason-input" ref={input} className="bp-input typo-body" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onKey} placeholder={decline ? B.reason_placeholder : B.note_placeholder} autoComplete="off" data-testid="blueprint-reason-input" />
      <div className="bp-dlg-cmd typo-code" data-testid="blueprint-reason-preview"><span className="typo-eyebrow">{B.reason_preview}</span> {preview}</div>
    </ModalShell>
  );
}
