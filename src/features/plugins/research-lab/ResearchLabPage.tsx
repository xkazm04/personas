import { lazy, Suspense } from 'react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { useSystemStore } from '@/stores/systemStore';

const ResearchDashboard = lazy(() => import('./sub_dashboard/ResearchDashboard'));
const ResearchProjectList = lazy(() => import('./sub_projects/ResearchProjectList'));
const LiteratureSearchPanel = lazy(() => import('./sub_literature/LiteratureSearchPanel'));

export default function ResearchLabPage() {
  const researchLabTab = useSystemStore((s) => s.researchLabTab);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Suspense fallback={<SuspenseFallback />}>
        {researchLabTab === 'dashboard' && <ResearchDashboard />}
        {researchLabTab === 'projects' && <ResearchProjectList />}
        {researchLabTab === 'literature' && <LiteratureSearchPanel />}
        {researchLabTab === 'hypotheses' && <ResearchProjectList />}
        {researchLabTab === 'experiments' && <ResearchProjectList />}
        {researchLabTab === 'findings' && <ResearchProjectList />}
        {researchLabTab === 'reports' && <ResearchProjectList />}
      </Suspense>
    </div>
  );
}
