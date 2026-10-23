// The ledger's one hook: the pure model (model/ledger.ts) over the sheet's store read, with the page state
// (ledgerStore.ts) and the sheet's shared selection. Every view of the page reads this; nothing here writes the store
// (the writes go through the sheet's `writes`, which re-reads after each).
import { useMemo } from 'react';
import { useSheet } from '../controller/SheetContext';
import {
  buildFindings, chipsOf, keeper, lensCols, ledgerOrder, packViews, statusCounts, targetsOf, triageRows,
  type Finding, type LensCol, type PackView,
} from '../model/ledger';
import { itemFacts, type ItemFacts } from '../model/ledgerFacts';
import type { ProposalStatus } from '@/lib/lensScan/wire';
import { useLedgerUi, type LedgerUi } from './ledgerStore';

export interface Ledger {
  ui: LedgerUi;
  all: Finding[];
  byId: ReadonlyMap<string, Finding>;
  /** The backlog's kept rows (status order, then value per effort). */
  rows: Finding[];
  lenses: LensCol[];
  counts: Record<ProposalStatus, number>;
  packs: PackView[];
  /** Every pack item. */
  items: Finding[];
  itemIds: ReadonlySet<string>;
  chips: { status: ProposalStatus; n: number }[];
  /** The rows the scope shows: the packs' kept items in pack order, or the backlog's rows. */
  scoped: Finding[];
  facts: ReadonlyMap<string, ItemFacts>;
  /** The sheet's shared selection (Space), in pick order. */
  selected: readonly string[];
  /** The keyboard order of the tab shown (J/K). */
  order: string[];
  /** The row the keys act on: the focus when it is in the order, else the first row. */
  current: string | null;
  /** What a triage decision acts on: the selected pack items, else the open item, else the focused one. */
  targets: string[];
  /** What a backlog decision acts on: the selected findings of the scope, else the focused one. */
  backlogTargets: string[];
}

export function useLedger(): Ledger {
  const s = useSheet();
  const ui = useLedgerUi(s.data.product.projectId);
  const scan = s.data.scan, plan = s.plan, selected = s.ui.selected;
  const base = useMemo(() => {
    const all = buildFindings(scan, plan);
    return { all, byId: new Map(all.map((f) => [f.p.id, f])), lenses: lensCols(all, plan), counts: statusCounts(all), facts: itemFacts(scan, plan.lenses) };
  }, [scan, plan]);
  const { lens, status, feat, q, scope } = ui;
  const view = useMemo(() => {
    const keep = keeper({ lens, status, feat, q }, plan);
    const rows = triageRows(base.all, keep);
    const { items, packs } = packViews(base.all, scan.packs, keep);
    const scoped = scope === 'packs' ? packs.flatMap((k) => k.shown) : rows;
    return { rows, items, packs, scoped, itemIds: new Set(items.map((f) => f.p.id)), chips: chipsOf(scope, base.counts, items) };
  }, [base, lens, status, feat, q, scope, plan, scan.packs]);
  return useMemo(() => {
    const order = ledgerOrder(ui.tab, view.scoped);
    const current = ui.focus && order.includes(ui.focus) ? ui.focus : order[0] ?? null;
    const scopeIds = new Set(view.scoped.map((f) => f.p.id));
    const sel = selected.filter((id) => scopeIds.has(id));
    return {
      ui, ...base, ...view, selected, order, current,
      targets: targetsOf(selected, ui.open, current, view.itemIds),
      backlogTargets: sel.length ? sel : current && !current.startsWith('feat:') ? [current] : [],
    };
  }, [base, view, ui, selected]);
}
