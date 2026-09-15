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
import { useMemo, type ReactNode } from 'react';
import { Boxes } from 'lucide-react';

import { InkTabs } from '../passport/passportInk';
import { useFactoryL2Data } from './factoryL2Data';
import { FactoryOverviewTab } from './FactoryOverviewTab';
import { FactoryObservabilityTab } from './FactoryObservabilityTab';

// Mirrored as `FactoryL2Tab` in stores/slices/system/uiSlice.ts (the store
// keeps a local union to avoid importing feature code) — keep the two in sync.
export type L2Tab = 'overview' | 'matrix' | 'observability';

export function FactoryProjectTabs({ projectId, matrix, onKpisChanged, tab, onTabChange }: {
  projectId: string;
  /** The legacy context×KPI matrix (renderGroups) — hosts the L3/L4 drill. */
  matrix: ReactNode;
  /** Fired after a KPI decision so the host can reload the matrix data too. */
  onKpisChanged?: () => void;
  /** CONTROLLED by the shell. The shell keys this subtree on the project id, so
   *  owning the tab locally would reset it to a default every time the
   *  breadcrumb switched project. Lifting it means the tab you are reading
   *  survives a project switch; only an explicit door (a plain open →
   *  'overview') chooses it for you. */
  tab: L2Tab;
  onTabChange: (tab: L2Tab) => void;
}) {
  // Constant since the Ship tab was retired (2026-09-15) — the only translated
  // label in the strip was its own; the other three have always been literals.
  const tabs = useMemo<Array<{ id: L2Tab; label: string }>>(() => [
    { id: 'overview', label: 'Overview' },
    { id: 'matrix', label: 'KPI matrix' },
    { id: 'observability', label: 'Observability' },
  ], []);
  const raw = useFactoryL2Data(projectId);
  const data = onKpisChanged
    ? { ...raw, reloadKpis: () => { raw.reloadKpis(); onKpisChanged(); } }
    : raw;

  return (
    <div data-testid="factory-l2-tabs">
      <div className="mb-3">
        <InkTabs tabs={tabs} active={tab} onChange={onTabChange} label="Module" icon={Boxes} />
      </div>
      {tab === 'overview' && <FactoryOverviewTab data={data} />}
      {tab === 'matrix' && matrix}
      {tab === 'observability' && <FactoryObservabilityTab data={data} />}
    </div>
  );
}
