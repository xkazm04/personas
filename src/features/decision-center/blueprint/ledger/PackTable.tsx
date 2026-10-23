import { useCallback, useMemo } from 'react';
import { useSheet } from '../controller/SheetContext';
import { Callout, Lnk } from './Controls';
import { ItemRow } from './ItemRow';
import { PackRow } from './PackRow';
import { clearFilters, setLedger, setScope } from './ledgerStore';
import type { Ledger } from './useLedger';
import type { LedgerActs } from './useLedgerActs';

/**
 * The In packs scope of the triage table (bp PackTable): a sticky head row, then each pack oldest first, its sticky
 * pack row over its shown items. Clicking a row opens it in the compare panel; its checkbox checks it into the
 * shared selection. Below ~760 px of width (a docked compare) a row folds into a two-line card, bp's container
 * breakpoints. No packs yet, or nothing kept by the filters: a callout says so and how to get there.
 */
export function PackTable({ L, acts }: { L: Ledger; acts: LedgerActs }) {
  const s = useSheet();
  const { B } = s.text;
  const { ui } = L;
  const sel = useMemo(() => new Set(L.selected), [L.selected]);
  const busy = s.ui.busy ? new Set(L.targets) : null;
  const onOpen = useCallback((id: string) => setLedger((u) => (u.open === id && u.focus === id ? u : { ...u, focus: id, open: id })), []);
  const { check, focus } = acts;
  const onCheck = useCallback((id: string) => check([id]), [check]);
  const onPack = useCallback((id: string) => { const k = L.packs.find((x) => x.pack.id === id); if (k) check(k.shown.map((f) => f.p.id)); }, [L.packs, check]);
  const progress = useMemo(() => new Map(L.packs.map((k) => [k.pack.id, k.items.map((f) => ({ id: f.p.id, status: f.status }))])), [L.packs]);

  if (!L.packs.length) return (
    <div className="tr-pt-empty">
      <Callout tone="empty" testId="blueprint-ledger-none"><b>{B.lg_no_packs_title}</b> {B.lg_no_packs} <Lnk onClick={() => setScope('backlog')}>{B.lg_to_backlog}</Lnk></Callout>
    </div>
  );
  if (!L.scoped.length) return (
    <div className="tr-pt-empty"><Callout tone="empty" testId="blueprint-ledger-none">{B.lg_no_match_items} <Lnk onClick={clearFilters}>{B.lg_clear_the_filters}</Lnk></Callout></div>
  );
  return (
    <div role="table" className="tr-pt" aria-label={B.lg_pack_items_label}>
      <div role="row" className="tr-thead">
        <span role="columnheader"><span className="sr-only">{B.lg_col_selected}</span></span>
        <span role="columnheader">{B.lg_col_lens}</span>
        <span role="columnheader" className="c-feat">{B.lg_col_feature}</span>
        <span role="columnheader">{B.lg_col_item}</span>
        <span role="columnheader">{B.lg_col_before_after}</span>
        <span role="columnheader" className="c-vd">{B.lg_col_verdict}</span>
        <span role="columnheader" className="c-ev">{B.lg_col_evidence}</span>
        <span role="columnheader">{B.lg_col_status}</span>
      </div>
      {L.packs.map((k) => {
        if (!k.shown.length) return null;
        const n = k.shown.filter((f) => sel.has(f.p.id)).length;
        return (
          <div role="rowgroup" key={k.pack.id} aria-label={k.pack.id}>
            <PackRow pack={k.pack} items={progress.get(k.pack.id) ?? []} all={n === k.shown.length} some={n > 0} onCheck={onPack} />
            {k.shown.map((f) => (
              <ItemRow key={f.p.id} p={f.p} fname={f.fname} facts={L.facts.get(f.p.id)} sel={sel.has(f.p.id)} focus={f.p.id === L.current} open={f.p.id === ui.open}
                pending={!!busy?.has(f.p.id)} onCheck={onCheck} onFocus={focus} onOpen={onOpen} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
