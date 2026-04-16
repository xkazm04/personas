import { lazy, Suspense } from 'react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { useSystemStore } from '@/stores/systemStore';

const ResearchDashboard = lazy(() => import('./sub_dashboard/ResearchDashboard'));
const ResearchProjectList = lazy(() => import('./sub_projects/ResearchProjectList'));
const LiteratureSearchPanel = lazy(() => import('./sub_literature/LiteratureSearchPanel'));
const HypothesesPanel = lazy(() => import('./sub_hypotheses/HypothesesPanel'));
const ExperimentsPanel = lazy(() => import('./sub_experiments/ExperimentsPanel'));
const FindingsPanel = lazy(() => import('./sub_findings/FindingsPanel'));
const ReportsPanel = lazy(() => import('./sub_reports/ReportsPanel'));
const GraphPanel = lazy(() => import('./sub_graph/GraphPanel'));

export default function ResearchLabPage() {
  const researchLabTab = useSystemStore((s) => s.researchLabTab);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Suspense fallback={<SuspenseFallback />}>
        {researchLabTab === 'dashboard' && <ResearchDashboard />}
        {researchLabTab === 'projects' && <ResearchProjectList />}
        {researchLabTab === 'literature' && <LiteratureSearchPanel />}
        {researchLabTab === 'hypotheses' && <HypothesesPanel />}
        {researchLabTab === 'experiments' && <ExperimentsPanel />}
        {researchLabTab === 'findings' && <FindingsPanel />}
        {researchLabTab === 'reports' && <ReportsPanel />}
        {researchLabTab === 'graph' && <GraphPanel />}
      </Suspense>
    </div>
  );
}
