import { useSheet } from '../controller/SheetContext';
import { counts } from '../model/aggregates';
import { keysFor } from '../model/keymap';
import { Keycaps } from './Keycap';
import { DockConsole } from './DockConsole';
import { HerePanel } from './HerePanel';
import { QueueList } from './QueueList';
import { StageBar } from './StageBar';

/**
 * The Build queue (the winning prototype's left column): printed on the plan's own paper, grid and ink so the
 * queue and the drawing read as one sheet. The product (its stage bar, as the plan prints it above a wing), where
 * the camera is, the work waiting there, the dock console, and the keys.
 */
export function QueueSidebar() {
  const s = useSheet();
  const { B, tx } = s.text;
  const c = counts(s.plan.S.features);
  const all = s.queueAll.filter((p) => p.status === 'proposed').length;
  return (
    <aside className="bp-side" aria-label={B.queue}>
      <div className="bp-sb-top"><span className="typo-eyebrow">{B.queue}</span><span className="typo-eyebrow bp-dim">{B.decision_center}</span></div>
      <section className="bp-prod" aria-label={s.data.product.name}>
        <span className="bp-pn typo-heading">{s.data.product.name}</span>
        <span className="bp-pc typo-data">{all}</span>
        <StageBar c={c} />
        <span className="bp-ps typo-code">{tx(B.product_line, { features: c.n, built: c.live })}{s.work.packFlow ? ` · ${B.pack_flow}` : ''}</span>
      </section>
      <HerePanel />
      <QueueList />
      <DockConsole />
      <div className="bp-ft typo-code">
        <span><Keycaps keys={[keysFor('next')[0] ?? '', keysFor('prev')[0] ?? '']} />{B.hint_walk}</span>
        <span><Keycaps keys={keysFor('approve')} />{B.hint_approve}</span>
        <span><Keycaps keys={keysFor('decline')} />{B.hint_decline}</span>
        <span><Keycaps keys={keysFor('build')} />{B.hint_build}</span>
        <span><Keycaps keys={keysFor('queue')} />{B.hint_hide}</span>
      </div>
    </aside>
  );
}
