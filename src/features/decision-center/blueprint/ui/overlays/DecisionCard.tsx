// bp's on-plan decision card (PORTED from bp src/components/Overlays.tsx DecisionCard, blueprint.css #dcard / .op): the
// current item's decision, drawn on the plan beside its feature (the drawing's own control; the queue lists the same
// work). 372 px, a 4 px amber rule on top (red at high risk), the RFI kicker, the item's title and summary, what it
// expects to move, one option row per move its status offers (each calls the sheet's single-item writes), and the
// walk to the previous and next item. Mounted by BlueprintSheet on the plan page.
// EDIT (port): bp's agent lines ("stopped at ... and asks", "answering frees ...") speak of its simulated swarm; a
// lens-scan item has a lens and a feature instead, so those lines say that.
import { useRef } from 'react';
import '../../styles/overlays.css';
import { useSheet } from '../../controller/SheetContext';
import { capOf, keysFor, type KeyAct } from '../../model/keymap';
import type { WorkItem } from '../../model/work';
import { deltaText } from '../format';
import { Press } from '../Press';
import { proposalSummary } from './summary';
import { useCardPlace } from './useCardPlace';

const W = 372;
/** The moves the card offers per status, in bp's option order; each names the key that does the same. */
type CardMove = 'approve' | 'decline' | 'build' | 'accept' | 'rework';
const MOVES_OF: Partial<Record<WorkItem['status'], CardMove[]>> = { proposed: ['approve', 'decline'], approved: ['build'], done: ['accept', 'rework'], failed: ['accept', 'rework'] };
const HIGH_RISK = 4;

export function DecisionCard() {
  const s = useSheet(), { B, tx, language } = s.text, p = s.current;
  const ref = useRef<HTMLDivElement>(null);
  const moves = p ? MOVES_OF[p.status] : undefined;
  // with items picked, the selection bar is the decision surface: one card at a time on the plan
  const shown = !!p && !!moves && !s.ui.sheet && !s.ui.overlay && s.ui.page === 'plan' && !s.ui.selected.length;
  useCardPlace(ref, s.engine, s.view, shown && p ? p.fid : null, W);
  if (!shown || !p || !moves) return null;
  const risk = p.risk ?? 0, urg = risk >= HIGH_RISK ? B.dc_urgent : risk >= 2 ? B.dc_soon : B.dc_when;
  const sum = proposalSummary(p.title, p.body), lens = s.plan.LENS[p.lens], pos = s.queue.findIndex((q) => q.id === p.id) + 1;
  const run = (m: CardMove) => {
    if (m === 'approve') void s.writes.approve(p);
    else if (m === 'decline') s.writes.askDecline(p);
    else if (m === 'build') s.writes.arm();
    else s.writes.askTriage(p, m);
  };
  const label: Record<CardMove, string> = { approve: B.verb_approve, decline: B.verb_decline, build: B.verb_build, accept: B.verb_accept, rework: B.verb_rework };
  const says: Record<CardMove, string> = { approve: B.dc_c_approve, decline: B.dc_c_decline, build: B.dc_c_build, accept: B.dc_c_accept, rework: B.dc_c_rework };
  return (
    <div ref={ref} className={'bp-dcard' + (risk >= HIGH_RISK ? ' u-high' : '')} role="region" aria-label={B.dc_label} data-testid="blueprint-decision-card" style={{ visibility: 'hidden' }}>
      <div className="k">
        <span>{tx(B.dc_kicker, { lens: lens?.short ?? p.lens, urgency: urg })}</span>
        <Press tone="x" aria-label={B.dlg_close} onClick={() => s.nav.select(null)}>{B.dlg_esc}</Press>
      </div>
      <h3>{p.title}</h3>
      {sum && <div className="psum">{sum}</div>}
      <div className="by">{tx(B.dc_by, { lens: lens?.name ?? p.lens, feature: p.f.name })}</div>
      <div className="meta"><span>{deltaText(s.plan, p, language)}</span><span>{tx(B.size_risk, { size: p.size, risk: p.risk ?? '-' })}</span></div>
      {moves.map((m, i) => (
        <Press key={m} tone={'op' + (i === 0 && m !== 'decline' ? ' rec' : '')} disabled={s.ui.busy} onClick={() => run(m)} data-testid={'blueprint-dc-' + m}>
          <i className="no" aria-hidden="true">{capOf(keysFor(m as KeyAct)[0] ?? '')}</i><b>{label[m]}</b><span>{says[m]}</span>
        </Press>
      ))}
      <div className="fx">{B.dc_fx}</div>
      <div className="nav">
        <Press aria-label={B.key_prev} onClick={() => s.nav.step(-1)}>{'‹'} {capOf(keysFor('prev')[0] ?? '')}</Press>
        <span>{tx(B.dc_pos, { pos: pos || '-', count: s.queue.length })}</span>
        <Press aria-label={B.key_next} onClick={() => s.nav.step(1)}>{capOf(keysFor('next')[0] ?? '')} {'›'}</Press>
      </div>
    </div>
  );
}
