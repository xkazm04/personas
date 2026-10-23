// What the ledger's keys and controls do, in one place: walk the rows, check rows into the shared selection, open an
// item in the compare panel, and send decisions through the sheet's writes (never a door of its own). A triage over
// checked rows is ONE batch (`writes.askMany`, the note prompt first when the move wants one); over the one current
// row it is `writes.askTriage` (a row whose feature is off the plan has no work item, so it goes as a batch of one).
import { useMemo } from 'react';
import { useSheet } from '../controller/SheetContext';
import { stepIn, underFocus } from '../model/ledger';
import type { TriageDecisionInput } from '../source';
import { setLedger, setTab } from './ledgerStore';
import type { Ledger } from './useLedger';

export interface LedgerActs {
  step(d: number): void;
  focus(id: string): void;
  /** Toggle rows into the shared selection: all of `ids` on, or off when every one is already checked. */
  check(ids: readonly string[]): void;
  /** Space: the current row (a matrix row checks its findings). */
  checkCurrent(): void;
  /** Open an item in the compare panel (again on the open one: full width). */
  open(id: string): void;
  /** Enter on the current row: compare (packs), the feature's L4 sheet (backlog), or the table on a matrix row's feature. */
  enter(): void;
  /** A triage move over the checked rows (else the targets); `only` sends exactly those ids (the compare footer). */
  triage(move: TriageDecisionInput, only?: readonly string[]): void;
  approve(): void;
  decline(): void;
  /** The matrix's drill-down: the triage table on this feature alone. */
  showInTable(slug: string): void;
  /** Leave the ledger and open the feature's L4 sheet on the finding's lens. */
  openFeature(fid: string, lens: string): void;
}

export function useLedgerActs(L: Ledger): LedgerActs {
  const s = useSheet();
  const { writes, work, dispatch, plan } = s;
  return useMemo(() => {
    const selected = new Set(L.selected);
    const check = (ids: readonly string[]) => {
      const on = !ids.every((id) => selected.has(id));
      for (const id of ids) if (selected.has(id) !== on) dispatch({ type: 'select', id });
    };
    const open = (id: string) => setLedger((u) => (u.open === id ? { ...u, wide: !u.wide, focus: id } : { ...u, focus: id, open: id }));
    const showInTable = (slug: string) => { setLedger((u) => ({ ...u, feat: new Set([slug]), focus: null })); setTab('triage'); };
    const openFeature = (fid: string, lens: string) => {
      dispatch({ type: 'page', page: 'plan' });
      dispatch({ type: 'openSheet', fid, lens: plan.LENS[lens] ? lens : 'general' });
    };
    const triage = (move: TriageDecisionInput, only?: readonly string[]) => {
      const sel = only ? [] : L.selected.filter((id) => L.itemIds.has(id));
      const ids = only ?? L.targets;
      if (sel.length) { writes.askMany(sel, move); return; }
      if (ids.length > 1) { writes.askMany([...ids], move); return; }
      const one = ids[0];
      if (!one) { writes.askTriage(null, move); return; }
      const w = work.byId.get(one);
      if (w) writes.askTriage(w, move); else writes.askMany([one], move);
    };
    return {
      step: (d) => {
        const id = stepIn(L.order, L.ui.focus && L.order.includes(L.ui.focus) ? L.ui.focus : null, d);
        if (id) setLedger((u) => (u.focus === id && (!u.open || u.open === id) ? u : { ...u, focus: id, open: u.open && u.scope === 'packs' && u.tab === 'triage' ? id : u.open }));
      },
      focus: (id) => setLedger((u) => (u.focus === id ? u : { ...u, focus: id })),
      check,
      checkCurrent: () => { const ids = underFocus(L.current, L.scoped); if (ids.length) check(ids); },
      open,
      enter: () => {
        const id = L.current;
        if (!id) return;
        if (id.startsWith('feat:')) { showInTable(id.slice(5)); return; }
        if (L.ui.scope === 'packs') { open(id); return; }
        const f = L.byId.get(id);
        if (f?.onPlan) openFeature(f.p.feature, f.p.lens);
      },
      triage,
      approve: () => {
        const ids = L.backlogTargets, w = ids.length === 1 && ids[0] ? work.byId.get(ids[0]) : undefined;
        if (w) void writes.approve(w); else void writes.decideMany(ids, 'approve');
      },
      decline: () => {
        const ids = L.backlogTargets, w = ids.length === 1 && ids[0] ? work.byId.get(ids[0]) : undefined;
        if (w) writes.askDecline(w); else writes.askMany(ids, 'decline');
      },
      showInTable,
      openFeature,
    };
  }, [L, writes, work, dispatch, plan]);
}
