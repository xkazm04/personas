// Factory L2: the per-project surface (R15 consolidation):
//   • Overview      DEFAULT. The consolidated Focus health of every context,
//                   the proposals review and the aggregated scans.
//   • KPI matrix    the context x KPI matrix, kept because it owns the L3 table
//                   and L4 console drill path.
//   • Observability LLM spend and production errors: the technical dimension.
// Since Gate 5 the head is a FactoryHead (the project under the Crumbs, whose
// Projects crumb is the door back to the portfolio, and the sibling switcher) and the tab strip is a kit Segmented in its
// Toolbar; each tab renders Sections on the same spine.
import type { ReactNode } from 'react';

import { Segmented, Toolbar } from '@/features/shared/components/kit';
import { FactoryHead } from '../FactoryHead';
import { useFactoryWords } from '../useFactoryWords';
import { useFactoryL2Data } from './factoryL2Data';
import { FactoryOverviewTab } from './FactoryOverviewTab';
import { FactoryObservabilityTab } from './FactoryObservabilityTab';

// Mirrored as `FactoryL2Tab` in stores/slices/system/uiSlice.ts (the store
// keeps a local union to avoid importing feature code). Keep the two in sync.
export type L2Tab = 'overview' | 'matrix' | 'observability';

export function FactoryProjectTabs({ projectId, matrix, onKpisChanged, tab, onTabChange, head }: {
  projectId: string;
  /** The context x KPI matrix (renderGroups); hosts the L3/L4 drill. */
  matrix: ReactNode;
  /** Fired after a KPI decision so the host can reload the matrix data too. */
  onKpisChanged?: () => void;
  /** CONTROLLED by the shell, so the tab survives a project switch. */
  tab: L2Tab;
  onTabChange: (tab: L2Tab) => void;
  /** The project head, built by the shell (it owns the navigation). */
  head: Omit<Parameters<typeof FactoryHead>[0], 'children'>;
}) {
  const w = useFactoryWords();
  const raw = useFactoryL2Data(projectId);
  const data = onKpisChanged
    ? { ...raw, reloadKpis: () => { raw.reloadKpis(); onKpisChanged(); } }
    : raw;

  return (
    <div data-testid="factory-l2-tabs">
      <FactoryHead {...head}>
        <Toolbar label={w.factory}>
          <Segmented<L2Tab>
            label={w.factory}
            value={tab}
            onChange={onTabChange}
            options={[
              { v: 'overview', label: w.overview },
              { v: 'matrix', label: w.L.matrix },
              { v: 'observability', label: w.observability },
            ]}
          />
        </Toolbar>
      </FactoryHead>
      {tab === 'overview' && <FactoryOverviewTab data={data} />}
      {tab === 'matrix' && matrix}
      {tab === 'observability' && <FactoryObservabilityTab data={data} />}
    </div>
  );
}
