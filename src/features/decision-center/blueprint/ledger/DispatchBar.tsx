import { useSheet } from '../controller/SheetContext';
import { capOf, keysFor } from '../model/keymap';
import { sizeW } from '../model/ledgerRules';
import { Btn } from './Controls';
import { KeyLine } from './KeyLine';
import { LensTag } from './Marks';
import type { Ledger } from './useLedger';
import type { LedgerActs } from './useLedgerActs';

/**
 * The Backlog scope's bar (bp variants/Triage DispatchBar): what is checked (or focused), the lenses it spans, its
 * effort, Clear (Esc), and the backlog's two decisions through the sheet's writes: Decline (asks why) and Approve.
 * bp's Dispatch (approve and start one execute run) is the Build queue's B here: approving never builds.
 */
export function DispatchBar({ L, acts }: { L: Ledger; acts: LedgerActs }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const ids = L.backlogTargets, n = L.selected.length;
  const rows = ids.map((id) => L.byId.get(id)).filter((f) => f !== undefined);
  const open = rows.filter((f) => f.status === 'proposed');
  const spans = [...new Set(rows.map((f) => f.p.lens))];
  const effort = open.reduce((a, f) => a + sizeW(f.p), 0);
  const label = n ? tx(B.lg_n_selected, { n }) + (open.length !== n ? ' · ' + tx(B.lg_can_go, { n: open.length }) : '') : ids[0] ? tx(B.lg_one_focused, { id: ids[0] }) : B.lg_nothing_selected;
  const key = (a: 'approve' | 'decline') => capOf(keysFor(a)[0] ?? '');
  return (
    <div className="lg-bar" role="region" aria-label={B.lg_decide} data-testid="blueprint-ledger-bar">
      <span className="lg-bar-n" aria-live="polite">{label}</span>
      {spans.length ? <span className="lg-bar-l">{tx(B.lg_lenses_n, { n: spans.length })}{spans.map((id) => <LensTag key={id} id={id} />)}</span>
        : <span className="lg-bar-l"><KeyLine scope="backlog" /></span>}
      {open.length ? <span className="lg-bar-e">{tx(B.lg_effort, { n: effort })}</span> : null}
      <span className="lg-sp" />
      <Btn kbd="Esc" disabled={!n} onClick={() => s.dispatch({ type: 'selectClear' })} testId="blueprint-ledger-clear">{B.lg_clear}</Btn>
      <Btn kbd={key('decline')} disabled={!open.length} onClick={acts.decline} testId="blueprint-ledger-decline">{B.verb_decline + (open.length ? ' ' + open.length : '')}</Btn>
      <Btn tone="go" kbd={key('approve')} disabled={!open.length} onClick={acts.approve} testId="blueprint-ledger-approve">{B.verb_approve + (open.length ? ' ' + open.length : '')}</Btn>
    </div>
  );
}
