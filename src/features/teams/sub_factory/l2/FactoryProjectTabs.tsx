// Factory L2 — the per-project surface (R15 consolidation: the R11 four-tab
// split collapsed per the bench verdict):
//   • Overview     — DEFAULT. The consolidated surface: Focus health grid +
//                    context-map coverage indicators + KPI proposals in the
//                    card tooltip (accept/reject inline) + the aggregated scan
//                    toolbar (KPIs · features · re-scan · full).
//   • KPI matrix   — the legacy context×KPI matrix, kept because it owns the
//                    L3 table / L4 KpiConsole drill path (consolidation fate
//                    to be decided with the dispatch concept).
//   • Observability— LLM + Monitoring mix: the technical dimension.
// The Dev Tools / Projects→KPIs originals still exist — dual-run continues.
import { useState, type ReactNode } from 'react';

import { InkTabs } from '../passport/passportInk';
import { useFactoryL2Data } from './factoryL2Data';
import { FactoryOverviewTab } from './FactoryOverviewTab';
import { FactoryObservabilityTab } from './FactoryObservabilityTab';

type L2Tab = 'overview' | 'matrix' | 'observability';

const TABS: Array<{ id: L2Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'matrix', label: 'KPI matrix' },
  { id: 'observability', label: 'Observability' },
];

export function FactoryProjectTabs({ projectId, matrix, onKpisChanged }: {
  projectId: string;
  /** The legacy context×KPI matrix (renderGroups) — hosts the L3/L4 drill. */
  matrix: ReactNode;
  /** Fired after a KPI decision so the host can reload the matrix data too. */
  onKpisChanged?: () => void;
}) {
  const [tab, setTab] = useState<L2Tab>('overview');
  const raw = useFactoryL2Data(projectId);
  const data = onKpisChanged
    ? { ...raw, reloadKpis: () => { raw.reloadKpis(); onKpisChanged(); } }
    : raw;

  return (
    <div data-testid="factory-l2-tabs">
      <div className="mb-3">
        <InkTabs tabs={TABS} active={tab} onChange={setTab} label="Module" />
      </div>
      {tab === 'overview' && <FactoryOverviewTab data={data} />}
      {tab === 'matrix' && matrix}
      {tab === 'observability' && <FactoryObservabilityTab data={data} />}
    </div>
  );
}
