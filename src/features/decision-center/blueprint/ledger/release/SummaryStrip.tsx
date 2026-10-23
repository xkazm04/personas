import { useMemo } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { releaseModel, summaryCounts } from '../../model/ledgerRelease';
import { Press } from '../../ui/Press';
import { setLedger, setTab } from '../ledgerStore';
import { releaseWord } from '../words';

/**
 * The ledger head's three counters (bp ReleaseView SummaryStrip): CHANGED (items built, how many moved), WAITING FOR
 * YOU (done + failed, with failed and in rework), WILL SHIP (the open release's version or the suggested one, its item
 * count and status). The first two open the In packs table, the third the Release tab.
 */
export function SummaryStrip() {
  const s = useSheet();
  const { B, tx } = s.text;
  const scan = s.data.scan, lenses = s.plan.lenses;
  const c = useMemo(() => summaryCounts(scan, lenses), [scan, lenses]);
  const m = useMemo(() => releaseModel(scan, lenses), [scan, lenses]);
  const v = m.rel?.version ?? m.suggestion.version, n = m.items.length;
  const toPacks = () => { setLedger((u) => (u.scope === 'packs' ? u : { ...u, scope: 'packs' })); setTab('triage'); };
  return (
    <div className="tr-sum" role="group" aria-label={B.lg_sum_label} data-testid="blueprint-ledger-summary">
      <Press tone="tr-sum-b" onClick={toPacks}>
        <small>{B.lg_sum_changed}</small><strong>{c.built}<em>{tx(B.lg_sum_changed_sub, { moved: c.moved })}</em></strong>
      </Press>
      <Press tone="tr-sum-b w" onClick={toPacks}>
        <small>{B.lg_sum_waiting}</small><strong>{c.waiting}<em>{tx(B.lg_sum_waiting_sub, { failed: c.failed, rework: c.rework })}</em></strong>
      </Press>
      <Press tone="tr-sum-b s" onClick={() => setTab('release')}>
        <small>{B.lg_sum_ship}</small><strong>{'v' + v}<em>{tx(B.lg_sum_ship_sub, { n, status: m.rel ? releaseWord(B, m.rel.status) : B.lg_no_draft })}</em></strong>
      </Press>
    </div>
  );
}
