import { lazy, Suspense, type ComponentType } from 'react';
import { FlaskConical } from 'lucide-react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
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
  const { t } = useTranslation();
  const researchLabTab = useSystemStore((s) => s.researchLabTab);
  const Active = TAB_COMPONENTS[researchLabTab];

  // Reuse the existing per-tab labels in t.research_lab.* as the subtitle
  // so the header reflects the current surface without needing new keys.
  const subtitle = t.research_lab[researchLabTab];

  return (
    <ContentBox>
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.shared.sidebar_extra.research_lab}
        subtitle={subtitle}
      />
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <ErrorBoundary name="Research Lab">
          <Suspense fallback={<SuspenseFallback />}>
            <Active />
          </Suspense>
        </ErrorBoundary>
      </div>
    </ContentBox>
  );
}
