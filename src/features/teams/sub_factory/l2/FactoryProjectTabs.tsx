// Factory L2 — the per-project surface, divided into FOUR TABS (2026-07
// restructure; docs/plans/dev-tools-cx-redesign.md):
//   a) KPIs         — proposals in the original review-queue structure (dense
//                     table + detail modal) restyled in ink, plus the existing
//                     context×KPI matrix keeping the L3/L4 drill alive.
//   b) Context map  — the Dev Tools Context Map's content in ink (read-focused
//                     during the dual-run; authoring stays in the original).
//   c) Observability— the LLM + Monitoring mix: the technical dimension.
//   d) Overview     — the cockpit prototype's Focus health grid wired to REAL
//                     contexts / KPIs / runtime sensors.
// The donor modules (Dev Tools tabs, Projects→KPIs) are NOT removed — dual-run
// until the Factory version proves itself.
import { useState, type ReactNode } from 'react';

import { InkTabs } from '../passport/passportInk';
import { useFactoryL2Data } from './factoryL2Data';
import { FactoryKpisTab } from './FactoryKpisTab';
import { FactoryContextTab } from './FactoryContextTab';
import { FactoryObservabilityTab } from './FactoryObservabilityTab';
import { FactoryOverviewTab } from './FactoryOverviewTab';

type L2Tab = 'kpis' | 'context' | 'observability' | 'overview';

// Overview leads — the health grid is the second-layer landing (Wall →
// Cockpit); the working modules follow.
const TABS: Array<{ id: L2Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'context', label: 'Context map' },
  { id: 'observability', label: 'Observability' },
];

export function FactoryProjectTabs({ projectId, matrix, onKpisChanged }: {
  projectId: string;
  /** The existing context×KPI matrix (renderGroups) — hosted under the KPIs tab
   *  so the L3 table / L4 console drill path keeps working. */
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
      {tab === 'kpis' && <FactoryKpisTab data={data} matrix={matrix} />}
      {tab === 'context' && <FactoryContextTab data={data} />}
      {tab === 'observability' && <FactoryObservabilityTab data={data} />}
      {tab === 'overview' && <FactoryOverviewTab data={data} />}
    </div>
  );
}
