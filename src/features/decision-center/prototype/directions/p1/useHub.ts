/**
 * The hub's level state: strip -> peek -> modal, and Esc walking back down.
 * Owns the walk (which queue, which item, which direction), the verdict
 * hand-off (advance BEFORE the Lab removes the item, so the next one is
 * already chosen when the decided one leaves) and the origin the sheet grows
 * out of and returns to.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { chipOf, type DecisionItem, type HubChip } from '../../../model/decisionModel';
import type { HubInitial, HubProps, PrototypeVerdict } from '../../directionContract';
import type { Origin } from './DecisionSheet';
import { queueOf, scopeLabel, type Scope } from './meta';
import type { Leave } from './useSheetFlow';
import type { Flash } from './VerdictFlash';

interface ModalState { scope: Scope; id: string; origin: Origin | null; exitOrigin: Origin | null; open: boolean }

function centerOf(el: Element | null): Origin | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * P1-only screenshot entries the Lab's own list does not carry (the Lab falls
 * back to `strip` for them, and the Hub reads the raw kit itself):
 *  - `p1:modal:report-html` opens the HTML report (also reachable by → from
 *    the markdown report in the report walk);
 *  - `p1:strip-states` shows a failed chip and a zero chip side by side.
 */
export function p1Kit(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('kit');
}
const kitHtml = () => p1Kit() === 'p1:modal:report-html';

function initialState(initial: HubInitial, items: DecisionItem[]): { peek: HubChip | null; modal: ModalState | null } {
  if (kitHtml()) {
    const it = items.find((i) => i.document?.format === 'html');
    if (it) return { peek: chipOf(it.kind), modal: { scope: { kind: 'type', type: 'report' }, id: it.id, origin: null, exitOrigin: null, open: true } };
  }
  if (initial.level === 'peek') return { peek: initial.chip, modal: null };
  if (initial.level === 'modal') {
    const scope: Scope = { kind: 'type', type: initial.type };
    const first = queueOf(scope, items, [])[0];
    if (first) return { peek: chipOf(first.kind), modal: { scope, id: first.id, origin: null, exitOrigin: null, open: true } };
  }
  return { peek: null, modal: null };
}

export function useHub({ items, ready, initial, onDecide }: HubProps) {
  const [init] = useState(() => initialState(initial, items));
  const [peek, setPeek] = useState<HubChip | null>(init.peek);
  const [modal, setModal] = useState<ModalState | null>(init.modal);
  const [dir, setDir] = useState<1 | -1>(1);
  const [leave, setLeave] = useState<Leave | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  const queue = useMemo(() => (modal ? queueOf(modal.scope, items, ready) : []), [modal, items, ready]);
  const index = modal ? Math.max(0, queue.findIndex((i) => i.id === modal.id)) : 0;
  const current = modal?.open ? queue[index] ?? null : null;

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);

  const togglePeek = useCallback((chip: HubChip) => setPeek((p) => (p === chip ? null : chip)), []);
  const closePeek = useCallback(() => setPeek(null), []);

  const open = useCallback((scope: Scope, item: DecisionItem, el: Element | null) => {
    setDir(1); setLeave(null);
    setModal({ scope, id: item.id, origin: centerOf(el), exitOrigin: null, open: true });
  }, []);

  const openFromPeek = useCallback((item: DecisionItem, el: HTMLElement | null) => {
    if (peek) open({ kind: 'chip', chip: peek }, item, el);
  }, [peek, open]);

  const triageAll = useCallback(() => {
    const first = items[0];
    if (first) { setPeek(null); open({ kind: 'all' }, first, document.querySelector('[data-p1-chip="all"]')); }
  }, [items, open]);

  /** Close back to where we came from: the peek row if it is showing, else the chip. */
  const close = useCallback(() => {
    setModal((m) => {
      if (!m) return m;
      const row = document.querySelector(`[data-p1-origin="${CSS.escape(m.id)}"]`);
      const chip = m.scope.kind === 'chip' ? m.scope.chip : m.scope.kind === 'all' ? 'all' : peek;
      const back = centerOf(row ?? document.querySelector(`[data-p1-chip="${chip}"]`));
      return { ...m, exitOrigin: back };
    });
    // Two phases: the exit origin must render before BaseModal unmounts the sheet.
    requestAnimationFrame(() => setModal((m) => (m ? { ...m, open: false } : m)));
  }, [peek]);

  const walk = useCallback((d: 1 | -1) => {
    if (!modal || queue.length < 2) return;
    const next = queue[(index + d + queue.length) % queue.length];
    if (!next) return;
    setDir(d); setLeave(null);
    setModal({ ...modal, id: next.id });
  }, [modal, queue, index]);

  const verdict = useCallback((v: PrototypeVerdict, kind: Leave) => {
    if (!modal) return;
    const after = queue[index + 1];
    const next = kind === 'skip' ? (after ?? queue[0]) : (after ?? queue[index - 1]);
    setDir(1); setLeave(kind);
    setFlash({ key: Date.now(), leave: kind, title: v.item.title });
    if (!next || next.id === v.item.id) close();
    else setModal({ ...modal, id: next.id });
    onDecide(v);
  }, [modal, queue, index, close, onDecide]);

  return {
    peek, togglePeek, closePeek, openFromPeek, triageAll,
    modal, current, queue, index, dir, leave, flash, close, walk, verdict,
    scope: modal ? scopeLabel(modal.scope) : '',
  };
}
