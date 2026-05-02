import { lazy, Suspense, type ComponentType } from 'react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { useSystemStore } from '@/stores/systemStore';
import type { ResearchLabTab } from '@/lib/types/types';

const TAB_COMPONENTS: Record<ResearchLabTab, ComponentType> = {
  dashboard: lazy(() => import('./sub_dashboard/ResearchDashboard')),
  projects: lazy(() => import('./sub_projects/ResearchProjectList')),
  literature: lazy(() => import('./sub_literature/LiteratureSearchPanel')),
  hypotheses: lazy(() => import('./sub_hypotheses/HypothesesPanel')),
  experiments: lazy(() => import('./sub_experiments/ExperimentsPanel')),
  findings: lazy(() => import('./sub_findings/FindingsPanel')),
  reports: lazy(() => import('./sub_reports/ReportsPanel')),
  graph: lazy(() => import('./sub_graph/GraphPanel')),
};

export default function ResearchLabPage() {
  const researchLabTab = useSystemStore((s) => s.researchLabTab);
  const Active = TAB_COMPONENTS[researchLabTab];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Suspense fallback={<SuspenseFallback />}>
        <Active />
      </Suspense>
    </div>
  );
}
