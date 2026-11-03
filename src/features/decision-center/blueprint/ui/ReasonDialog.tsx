import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSheet } from '../controller/SheetContext';
import { cardBrief, declinePrefill } from '../model/cardBrief';
import type { NoteMove } from '../state/uiState';
import { BpDialog } from './dialog/BpDialog';
import { deltaText } from './format';
import { Keycap } from './Keycap';
import { LensGlyphIcon } from './LensGlyphIcon';

/**
 * The note prompt: the decline reason (X; pre-filled on a repeat of a declined idea), and the note a triage asks (WP4b: R rework, S descope, Y on a failed build).
 * The item's card, one labelled field, and a live preview of the exact call that will be made (`decide` or `triage`,
 * the id, the decision and the note). Enter sends it, Esc cancels. A decline without words sends "no reason given"; a
 * triage sends exactly what was typed, and nothing when nothing was: the store has the last word, and a refusal (a
 * failed build accepted without a note: `note-required`) comes back in the dock console, never pre-empted here.
 */
export function ReasonDialog({ itemId, move, ids }: { itemId: string; move: NoteMove; ids?: string[] }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const p = s.work.byId.get(itemId);
  // A decline of ONE item that repeats a declined idea opens with the note naming the decision it repeats (the brief's
  // repeatNote): the person may edit it, and Enter sends it as the new row's decision_note. A batch opens empty.
  const [note, setNote] = useState(() => (move === 'decline' && !(ids && ids.length > 1) && p ? declinePrefill(cardBrief(s.data, s.plan, p)) : ''));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const id = requestAnimationFrame(() => input.current?.focus()); return () => cancelAnimationFrame(id); }, []);
  if (!p) return null;
  const L = s.plan.LENS[p.lens];
  const decline = move === 'decline';
  const text = note.trim();
  const close = () => { s.dispatch({ type: 'overlay', overlay: null }); s.dispatch({ type: 'say', text: B.say_cancelled }); };
  const many = ids && ids.length > 1 ? ids : null;
  const send = () => {
    if (many) { if (decline) void s.writes.decideMany(many, 'decline', text || B.no_reason); else void s.writes.triageMany(many, move, text || undefined); return; }
    if (decline) void s.writes.decline(p, text || B.no_reason); else void s.writes.triage(p, move, text || undefined);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); send(); }
  };
  const idList = JSON.stringify(many ?? [p.id]);
  const preview = decline
    ? `decide(${idList}, "decline", ${JSON.stringify(text || B.no_reason)})`
    : `triage(${idList}, "${move}"${text ? `, ${JSON.stringify(text)}` : ''})`;
  const title = { decline: B.reason_question, rework: B.note_q_rework, descope: B.note_q_descope, accept: B.note_q_accept }[move];
  return (
    <BpDialog
      onClose={close}
      titleId="bp-reason-title"
      title={title}
      sub={tx(decline ? B.reason_for : B.note_for, { lens: L?.name ?? p.lens })}
      footer={<><span><Keycap k="Enter" /> {B.hint_send}</span><span><Keycap k="Escape" /> {B.hint_cancel}</span></>}
    >
      <div className="bp-ctx">
        <span className="bp-g"><LensGlyphIcon glyph={L?.glyph ?? null} /></span>
        <span>
          <b>{many ? tx(B.reason_for_many, { count: many.length }) : p.title}</b>
          <span className="bp-ctx-m">{p.f.name} {'·'} {tx(B.size_risk, { size: p.size, risk: p.risk ?? '-' })} {'·'} {deltaText(s.plan, p, language)}</span>
        </span>
      </div>
      <label className="bp-dlg-l" htmlFor="bp-reason-input">{decline ? B.reason_label : B.note_label}</label>
      <input id="bp-reason-input" ref={input} className="bp-input" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onKey} placeholder={decline ? B.reason_placeholder : B.note_placeholder} autoComplete="off" data-testid="blueprint-reason-input" />
      <div className="bp-dlg-cmd" data-testid="blueprint-reason-preview"><span className="bp-kick">{B.reason_preview}</span> {preview}</div>
    </BpDialog>
  );
}
