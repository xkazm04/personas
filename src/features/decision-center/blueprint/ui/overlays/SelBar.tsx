// bp's selection bar (PORTED from bp src/components/Overlays.tsx SelBar, blueprint.css #selbar / .btn): the items picked
// with Space or Shift+click (`ui.selected`), what they are, and the batch moves their statuses allow, each ONE store call
// over every picked id (`writes.decideMany` / `writes.askMany`, which asks the note first when the move wants one). The
// store answers per item; the bar never withholds an id it guesses would be refused. Esc clears (the sheet's ladder).
// EDIT (port): bp's swarm moves (look closer, push, pause, resume, orders and their preview) steer its simulated agents;
// a drawing set's picked items take the decision machine's moves instead.
import '../../styles/overlays.css';
import { useSheet } from '../../controller/SheetContext';
import { actable, type MoveName } from '../../model/states';
import type { WorkItem } from '../../model/work';
import { Press } from '../Press';

type BatchMove = Exclude<MoveName, 'build'>;
const ORDER: readonly BatchMove[] = ['approve', 'decline', 'accept', 'rework', 'descope', 'reopen'];
const SHOW = 6;

/** The batch moves a selection offers: those at least one picked item's status allows (the state table's `from`). */
export function batchMoves(items: readonly WorkItem[]): BatchMove[] {
  return ORDER.filter((m) => items.some((p) => actable(m, p.status)));
}

export function SelBar() {
  const s = useSheet(), { B, tx } = s.text, ids = s.ui.selected;
  if (!ids.length || s.ui.page !== 'plan') return null;
  const items = ids.map((id) => s.work.byId.get(id)).filter((p): p is WorkItem => !!p);
  const features = new Set(items.map((p) => p.fid)).size;
  const waiting = items.filter((p) => p.status === 'proposed').length, built = items.filter((p) => p.status === 'done' || p.status === 'failed').length;
  const label: Record<BatchMove, string> = { approve: B.verb_approve, decline: B.verb_decline, accept: B.verb_accept, rework: B.verb_rework, descope: B.verb_descope, reopen: B.verb_reopen };
  const go = (m: BatchMove) => (m === 'approve' ? void s.writes.decideMany(ids, 'approve') : s.writes.askMany(ids, m));
  return (
    <div className="bp-selbar" role="region" aria-label={B.sel_label} data-testid="blueprint-selbar">
      <span className="sel-sum">
        <b>{tx(B.sel_count, { count: ids.length })}</b> {'·'} {tx(features === 1 ? B.sum_features_one : B.sum_features_other, { count: features })}
        {waiting > 0 && <> {'·'} {tx(B.count_waiting, { count: waiting })}</>}
        {built > 0 && <> {'·'} {tx(B.sel_built, { count: built })}</>}
      </span>
      {batchMoves(items).map((m) => (
        <Press key={m} tone={'btn' + (m === 'approve' || m === 'accept' ? ' go' : m === 'decline' ? ' no' : '')} disabled={s.ui.busy} onClick={() => go(m)} data-testid={'blueprint-sel-' + m}>
          {label[m]}
        </Press>
      ))}
      <Press tone="btn" aria-label={B.sel_clear} onClick={() => s.dispatch({ type: 'selectClear' })}>{'✕'}</Press>
      <span className="sel-items">
        {items.slice(0, SHOW).map((p) => <span key={p.id} className="sel-item">{p.f.code ? p.f.code + ' · ' : ''}{p.title}</span>)}
        {items.length > SHOW && <span className="sel-item">{tx(B.sel_more, { count: items.length - SHOW })}</span>}
      </span>
    </div>
  );
}
