import { memo, useMemo } from 'react';
import { useSheet } from '../controller/SheetContext';
import type { Finding } from '../model/ledger';
import { RISK_MARK, riskBand } from '../model/ledgerRules';
import { deltaText } from '../ui/format';
import { Press } from '../ui/Press';
import { Callout } from './Controls';
import { LensTag, StateMark } from './Marks';
import type { Ledger } from './useLedger';
import type { LedgerActs } from './useLedgerActs';

interface RowProps { f: Finding; on: boolean; focus: boolean; move: string; acts: LedgerActs }

const Row = memo(function Row({ f, on, focus, move, acts }: RowProps) {
  const { B, tx } = useSheet().text;
  const p = f.p, band = riskBand(p.risk);
  const kind = p.kind === 'fix' || p.kind === 'work-item' ? null : p.kind === 'baseline-upgrade' ? B.lg_kind_upgrade : p.parent_id ? tx(B.lg_kind_propagation_of, { id: p.parent_id }) : B.lg_kind_propagation;
  return (
    <div role="row" className={'lg-tr' + (on ? ' on' : '') + ' s-' + f.status} data-fid={p.id} data-testid="blueprint-ledger-finding" tabIndex={focus ? 0 : -1}
      onFocus={(e) => { if (e.target === e.currentTarget) acts.focus(p.id); }}
      onClick={(e) => { acts.focus(p.id); if (!(e.target as HTMLElement).closest('button, input')) acts.check([p.id]); }}>
      <span role="cell" className="c-sel"><input type="checkbox" tabIndex={-1} checked={on} onChange={() => acts.check([p.id])} aria-label={tx(B.lg_check_item, { id: p.id })} /></span>
      <span role="cell" className="c-lens"><LensTag id={p.lens} /></span>
      <span role="cell" className="c-feat">
        <Press tone="lg-feat" disabled={!f.onPlan} tabIndex={focus ? 0 : -1} onClick={(e) => { e.stopPropagation(); acts.openFeature(p.feature, p.lens); }}>{f.fname}</Press>
      </span>
      <span role="cell" className="c-title"><span className="lg-t">{p.title}</span>{kind ? <span className="lg-kind">{kind}</span> : null}</span>
      <span role="cell" className="c-mv"><span className="lg-mv">{move}</span></span>
      <span role="cell" className="c-risk"><span className={'lg-risk r-' + band}><b aria-hidden="true">{RISK_MARK[band]}</b>{p.risk ?? '–'}<span className="sr-only"> {B[`lg_risk_${band}` as const]}</span></span></span>
      <span role="cell" className="c-size"><span className="lg-size">{p.size ?? '–'}</span></span>
      <span role="cell" className="c-st"><StateMark status={f.status} /></span>
    </div>
  );
});

/**
 * The Backlog scope of the triage table (bp variants/Triage): one dense row per finding (lens, feature, title, before
 * -> expected, risk, size, status), open ones first and best value per effort first within a status. J/K move, Space
 * checks, A approves and X declines the checked rows (or the focused one), Enter opens the feature's L4 sheet. "Inbox
 * zero" when nothing is proposed.
 */
export function Triage({ L, acts }: { L: Ledger; acts: LedgerActs }) {
  const s = useSheet();
  const { B, language } = s.text;
  const sel = useMemo(() => new Set(L.selected), [L.selected]);
  const open = L.rows.filter((f) => f.status === 'proposed').length;
  const proposedShown = !L.ui.status.size || L.ui.status.has('proposed');
  const moveOf = (f: Finding): string => {
    const w = s.work.byId.get(f.p.id);
    return w ? deltaText(s.plan, w, language) : f.p.metric ?? '';
  };
  return (
    <div className="lg-tri">
      {proposedShown && !open && L.all.length ? <div className="lg-zero"><b>{B.lg_inbox_zero}</b>{L.ui.lens.size || L.ui.q ? B.lg_inbox_zero_filtered : B.lg_inbox_zero_body}</div> : null}
      {L.rows.length ? (
        <div role="table" className="lg-tbl" aria-label={B.lg_findings}>
          <div role="row" className="lg-tr hd">
            <span role="columnheader" className="c-sel"><span className="sr-only">{B.lg_col_selected}</span></span>
            <span role="columnheader" className="c-lens">{B.lg_col_lens}</span>
            <span role="columnheader" className="c-feat">{B.lg_col_feature}</span>
            <span role="columnheader" className="c-title">{B.lg_col_finding}</span>
            <span role="columnheader" className="c-mv">{B.lg_col_before_expected}</span>
            <span role="columnheader" className="c-risk">{B.lg_col_risk}</span>
            <span role="columnheader" className="c-size">{B.lg_col_size}</span>
            <span role="columnheader" className="c-st">{B.lg_col_status}</span>
          </div>
          {L.rows.map((f) => <Row key={f.p.id} f={f} on={sel.has(f.p.id)} focus={f.p.id === L.current} move={moveOf(f)} acts={acts} />)}
        </div>
      ) : <Callout tone="empty" testId="blueprint-ledger-none">{L.all.length ? B.lg_no_match_findings : B.lg_no_findings}</Callout>}
    </div>
  );
}
