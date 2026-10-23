import { useMemo, type RefObject } from 'react';
import { useSheet } from '../controller/SheetContext';
import { isFiltered } from '../model/ledger';
import { LensGlyphIcon } from '../ui/LensGlyphIcon';
import { Press } from '../ui/Press';
import { Seg } from './Controls';
import { StateMark, stateWord } from './Marks';
import { clearFilters, setLedger, setScope, toggleLens, toggleStatus } from './ledgerStore';
import type { Ledger } from './useLedger';

/**
 * The ledger's filter line (bp LedgerPage Filters): the scope (In packs n | Backlog n), the scope's status chips (each
 * with its mark and count), the lens chips (glyph, short name, count in the scope), the matrix's feature drill-down as a
 * removable chip, the text filter (/) and Clear filters. bp's per-lens scan menu is not ported: scans start in bp.
 */
export function Filters({ L, filter }: { L: Ledger; filter: RefObject<HTMLInputElement | null> }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const ui = L.ui, packs = ui.scope === 'packs';
  const lenses = useMemo(() => {
    if (!packs) return L.lenses.filter((l) => l.n);
    const n = new Map<string, number>();
    for (const f of L.items) n.set(f.p.lens, (n.get(f.p.lens) ?? 0) + 1);
    return L.lenses.filter((l) => n.has(l.id)).map((l) => ({ ...l, n: n.get(l.id) ?? 0 }));
  }, [packs, L.lenses, L.items]);
  return (
    <div className="lg-filt" data-testid="blueprint-ledger-filters">
      <Seg label={B.lg_scope} value={ui.scope} onChange={setScope} options={[
        { value: 'packs', label: tx(B.lg_scope_packs, { n: L.items.length }) },
        { value: 'backlog', label: tx(B.lg_scope_backlog, { n: L.all.length }) },
      ]} />
      <div className="lg-chips" role="group" aria-label={B.lg_status}>
        {L.chips.map(({ status: st, n }) => (
          <Press key={st} tone={'lg-chip s-' + st} on={ui.status.has(st)} onClick={() => toggleStatus(st)}>
            <StateMark status={st} form="glyph" />{stateWord(B, st)}<b>{n}</b>
          </Press>
        ))}
      </div>
      <div className="lg-chips" role="group" aria-label={B.lg_lens}>
        {lenses.map((l) => (
          <Press key={l.id} tone="lg-chip" on={ui.lens.has(l.id)} onClick={() => toggleLens(l.id)} aria-label={tx(B.lg_lens_chip, { name: l.name, n: l.n })}>
            <LensGlyphIcon glyph={l.glyph} />{l.short}<b>{l.n}</b>
          </Press>
        ))}
      </div>
      {ui.feat.size ? (
        <div className="lg-chips" role="group" aria-label={B.lg_feature}>
          {[...ui.feat].map((slug) => (
            <Press key={slug} tone="lg-chip lg-fchip" on onClick={() => setLedger((u) => { const f = new Set(u.feat); f.delete(slug); return { ...u, feat: f }; })}>
              {tx(B.lg_feature_chip, { name: L.all.find((f) => f.p.feature === slug)?.fname ?? slug })}<span aria-hidden="true">×</span>
            </Press>
          ))}
        </div>
      ) : null}
      <input ref={filter} className="lg-q" type="search" value={ui.q} placeholder={packs ? B.lg_filter_items : B.lg_filter_findings}
        aria-label={packs ? B.lg_filter_items_label : B.lg_filter_findings_label} data-testid="blueprint-ledger-q"
        onChange={(e) => { const q = e.target.value; setLedger((u) => ({ ...u, q })); }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault(); e.stopPropagation();
          if (ui.q) setLedger((u) => ({ ...u, q: '' })); else e.currentTarget.closest<HTMLElement>('.lg-page')?.focus();
        }} />
      {isFiltered(ui) ? <Press tone="lg-x" onClick={clearFilters}>{B.lg_clear_filters}</Press> : null}
    </div>
  );
}
