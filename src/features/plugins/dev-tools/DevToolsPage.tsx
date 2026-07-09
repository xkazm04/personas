import { lazy, Suspense } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const ProjectOverviewPage = lazy(() => import('./sub_overview/ProjectOverviewPage'));
const LlmOverviewPage = lazy(() => import('./sub_llm_overview/LlmOverviewPage'));
const ContextMapPage = lazy(() => import('./sub_context/ContextMapPage'));
const IdeaScannerPage = lazy(() => import('./sub_scanner/IdeaScannerPage'));
const IdeaTriagePage = lazy(() => import('./sub_triage/IdeaTriagePage'));
const TaskRunnerPage = lazy(() => import('./sub_runner/TaskRunnerPage'));
const FleetPage = lazy(() => import('@/features/plugins/fleet/FleetPage'));

// ---------------------------------------------------------------------------
// Main Page
//
// Project management + Goals were folded into the "Projects" (Teams) section;
// this surface hosts the dev-automation tools only.
// ---------------------------------------------------------------------------

export default function DevToolsPage() {
  const devToolsTab = useSystemStore((s) => s.devToolsTab);

  return (
    <div className="h-full w-full flex flex-col">
      <div
        data-testid="dev-tools-page"
        key={devToolsTab}
        className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
      >
        <Suspense fallback={<SuspenseFallback />}>
          {devToolsTab === 'overview' && <ProjectOverviewPage />}
          {devToolsTab === 'llm-overview' && <LlmOverviewPage />}
          {devToolsTab === 'context-map' && <ContextMapPage />}
          {devToolsTab === 'idea-scanner' && <IdeaScannerPage />}
          {devToolsTab === 'idea-triage' && <IdeaTriagePage />}
          {devToolsTab === 'task-runner' && <TaskRunnerPage />}
          {(devToolsTab === 'skills' || devToolsTab === 'fleet') && <FleetPage />}
        </Suspense>
      </div>
    </div>
  );
}
