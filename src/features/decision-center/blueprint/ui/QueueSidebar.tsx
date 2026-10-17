import '../styles/counts.css';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSheet } from '../controller/SheetContext';
import { counts } from '../model/aggregates';
import { figures, offPlanWaiting, waitingOf } from '../model/counts';
import { keysFor } from '../model/keymap';
import { Keycap, Keycaps } from './Keycap';
import { DockConsole } from './DockConsole';
import { HerePanel } from './HerePanel';
import { Press } from './Press';
import { QueueList } from './QueueList';
import { StageBar } from './StageBar';

/**
 * The Build queue (a Personas addition the operator kept), inked as bp's review workbench (bp rail/wide
 * workbench.css): a --bp-card column with a flyout-style head, the product as bp's strip figure over its stage bar,
 * where the camera is, the work waiting there as workbench rows, the dock console as bp's terminal, and the keys.
 */
export function QueueSidebar() {
  const s = useSheet();
  const { B, tx } = s.text;
  const c = counts(s.plan.S.features), fg = figures(s.plan.S.features);
  const all = waitingOf(s.queueAll), off = offPlanWaiting(s.work);
  return (
    <aside className="bp-side" aria-label={B.queue}>
      <div className="bp-sb-top"><h2>{B.queue}</h2><span className="bp-kick">{B.decision_center}</span></div>
      <section className="bp-prod" aria-label={s.data.product.name}>
        <span className="bp-pn">{s.data.product.name}</span>
        <span className="bp-pc">{all}</span>
        <StageBar c={c} />
        <span className="bp-ps">{tx(B.product_line_live, { features: fg.n, live: fg.live })}{s.work.packFlow ? ` · ${B.pack_flow}` : ''}</span>
      </section>
      {off > 0 && (
        <div className="bp-offplan-row">
          <Tooltip content={B.off_plan_open}>
            <Press tone="bp-offplan" onClick={() => s.dispatch({ type: 'page', page: 'ledger' })} data-testid="blueprint-offplan">{tx(B.off_plan_waiting, { count: off })}</Press>
          </Tooltip>
        </div>
      )}
      <HerePanel />
      <QueueList />
      <DockConsole />
      <div className="bp-ft">
        <span><Keycaps keys={[keysFor('next')[0] ?? '', keysFor('prev')[0] ?? '']} />{B.hint_walk}</span>
        <span><Keycaps keys={keysFor('approve')} />{B.hint_approve}</span>
        <span><Keycaps keys={keysFor('decline')} />{B.hint_decline}</span>
        <span><Keycaps keys={keysFor('build')} />{B.hint_build}</span>
        <span><Keycaps keys={keysFor('queue')} />{B.hint_hide}</span>
        <span><Keycaps keys={keysFor('ledger')} />{B.hint_ledger}</span>
        <span><Keycaps keys={keysFor('timeline')} />{B.hint_timeline}</span>
        <span><Keycaps keys={keysFor('select')} />{B.hint_select}</span>
        <Press tone="bp-ft-help" onClick={() => s.dispatch({ type: 'overlay', overlay: { kind: 'help' } })} data-testid="blueprint-help-key"><Keycap k={keysFor('help')[0] ?? '?'} />{B.hint_help}</Press>
      </div>
    </aside>
  );
}
