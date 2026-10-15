import { Bot, ListChecks, Map as MapIcon, Search } from 'lucide-react';
import { useSheet } from '../controller/SheetContext';
import { Press } from './Press';

/**
 * The right rail (bp Dock): Find, the Build queue (shown or hidden), the agents running for this product, and the
 * plan (back to the whole site). bp's View control is not ported: in the prototype it only raised a message.
 */
export function RightRail() {
  const s = useSheet();
  const { B, tx } = s.text;
  const running = s.work.activeRuns;
  return (
    <nav className="bp-rr" aria-label={B.rail}>
      <Press onClick={() => s.dispatch({ type: 'overlay', overlay: { kind: 'find' } })} aria-label={B.find}>
        <Search aria-hidden="true" /><span className="typo-label">{B.find}</span><kbd className="bp-kbd typo-code">/</kbd>
      </Press>
      <Press tone="bp-rv" on={s.ui.queueOpen} onClick={() => s.dispatch({ type: 'queue' })} aria-label={B.queue_toggle}>
        <ListChecks aria-hidden="true" /><span className="bp-v typo-data">{s.queue.length}</span><span className="typo-label">{B.ledger}</span>
      </Press>
      <Press onClick={() => s.dispatch({ type: 'say', text: tx(B.say_agents, { running, runs: s.work.runs.length }) })} aria-label={B.agents}>
        <Bot aria-hidden="true" /><span className="bp-v typo-data">{running}</span><span className="typo-label">{B.agents}</span>
      </Press>
      <Press onClick={() => s.nav.toLevel(0)} aria-label={B.plan}>
        <MapIcon aria-hidden="true" /><span className="bp-v typo-code">G-001</span><span className="typo-label">{B.plan}</span>
      </Press>
    </nav>
  );
}
