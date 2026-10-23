import { useMemo } from 'react';
import { useSheet } from '../controller/SheetContext';
import { matrixRows, type Finding, type LensCol } from '../model/ledger';
import { RISK_BANDS, RISK_MARK, riskBand, type RiskBand } from '../model/ledgerRules';
import { LensGlyphIcon } from '../ui/LensGlyphIcon';
import { Press } from '../ui/Press';
import { Btn, Callout } from './Controls';
import { StateMark } from './Marks';
import type { Ledger } from './useLedger';
import type { LedgerActs } from './useLedgerActs';

interface CellProps { items: Finding[]; lens: LensCol; feat: string; sel: ReadonlySet<string>; act: boolean; packs: boolean; acts: LedgerActs }

/** One feature x lens cell: pack items by their state marks (In packs), or findings counted by risk band (Backlog). */
function Cell({ items, lens, feat, sel, act, packs, acts }: CellProps) {
  const { B, tx } = useSheet().text;
  if (!items.length) return <td className="lg-mc none"><span aria-hidden="true">·</span></td>;
  const ids = items.map((f) => f.p.id), all = ids.every((id) => sel.has(id)), some = !all && ids.some((id) => sel.has(id));
  const n = Object.fromEntries(RISK_BANDS.map((b) => [b, items.filter((f) => riskBand(f.p.risk) === b).length])) as Record<RiskBand, number>;
  const said = packs ? items.map((f) => f.p.id).join(', ') : RISK_BANDS.filter((b) => n[b]).map((b) => n[b] + ' ' + B[`lg_risk_${b}` as const]).join(', ');
  return (
    <td className={'lg-mc' + (all ? ' on' : some ? ' part' : '')}>
      <Press tabIndex={act ? 0 : -1} on={all} aria-label={tx(B.lg_cell_label, { lens: lens.name, feature: feat, what: said })} onClick={() => acts.check(ids)}>
        {packs
          ? <span className="lg-pkm">{items.map((f) => <StateMark key={f.p.id} status={f.status} form="glyph" />)}</span>
          : RISK_BANDS.map((b) => (n[b] ? <span key={b} className={'r-' + b}><b aria-hidden="true">{RISK_MARK[b]}</b>{n[b]}</span> : null))}
      </Press>
    </td>
  );
}

/**
 * The Feature x lens matrix (bp variants/Matrix): a row per feature with rows in the scope (map order), a column per
 * lens. A cell checks its findings (again: unchecks); the row head checks the feature's findings across every lens; the
 * row's Table (or Enter) opens the triage table on that feature alone. bp's per-row Dispatch is not offered: approving
 * and building happen in the backlog table and the Build queue, through the sheet's own writes.
 */
export function Matrix({ L, acts }: { L: Ledger; acts: LedgerActs }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const packs = L.ui.scope === 'packs';
  const rows = useMemo(() => matrixRows(L.scoped), [L.scoped]);
  const sel = useMemo(() => new Set(L.selected), [L.selected]);
  const cols = L.lenses.filter((l) => l.enabled || l.n);
  if (!rows.length) return <div className="tr-pt-empty"><Callout tone="empty" testId="blueprint-ledger-none">{packs ? (L.items.length ? B.lg_no_match_items : B.lg_no_packs) : L.all.length ? B.lg_no_match_findings : B.lg_no_findings}</Callout></div>;
  return (
    <div className="lg-mx-wrap">
      <table className="lg-mx" data-testid="blueprint-ledger-matrix">
        <caption className="sr-only">{packs ? B.lg_matrix_caption_packs : B.lg_matrix_caption_backlog}</caption>
        <thead>
          <tr>
            <th scope="col" className="lg-mf">{B.lg_col_feature}</th>
            {cols.map((l) => <th key={l.id} scope="col" aria-label={l.name}><LensGlyphIcon glyph={l.glyph} /><span>{l.short}</span></th>)}
            <th scope="col" className="lg-md"><span className="sr-only">{B.lg_col_table}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ids = r.items.map((f) => f.p.id), on = ids.every((id) => sel.has(id)), key = 'feat:' + r.slug, act = L.current === key;
            return (
              <tr key={r.slug} className={(on ? 'on' : '') + (act ? ' fx' : '')} data-fid={key} tabIndex={act ? 0 : -1} onFocus={(e) => { if (e.target === e.currentTarget) acts.focus(key); }}>
                <th scope="row" className="lg-mf">
                  <Press tabIndex={act ? 0 : -1} on={on} aria-label={tx(B.lg_check_feature, { name: r.name })} onClick={() => { acts.focus(key); acts.check(ids); }}>
                    <b>{r.name}</b>{r.domain ? <span>{r.domain}</span> : null}
                  </Press>
                </th>
                {cols.map((l) => <Cell key={l.id} items={r.items.filter((f) => f.p.lens === l.id)} lens={l} feat={r.name} sel={sel} act={act} packs={packs} acts={acts} />)}
                <td className="lg-md"><Btn size="row" tip={tx(B.lg_table_tip, { n: r.items.length, name: r.name })} onClick={() => acts.showInTable(r.slug)}>{B.lg_table}</Btn></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
