import { lazy, Suspense } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';

const ProjectOverviewPage = lazy(() => import('./sub_overview/ProjectOverviewPage'));
const LlmOverviewPage = lazy(() => import('./sub_llm_overview/LlmOverviewPage'));
const ContextMapPage = lazy(() => import('./sub_context/ContextMapPage'));
const RunDeskPage = lazy(() => import('./sub_runner/RunDeskPage'));
const FleetPage = lazy(() => import('@/features/plugins/fleet/FleetPage'));
const WorkspacesPage = lazy(() => import('./sub_workspaces/WorkspacesPage'));
const SkillsManagerPage = lazy(() => import('./sub_skills/SkillsManagerPage'));

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
        <Suspense fallback={<RouteChunkSkeleton />}>
          {devToolsTab === 'overview' && <ProjectOverviewPage />}
          {devToolsTab === 'llm-overview' && <LlmOverviewPage />}
          {devToolsTab === 'context-map' && <ContextMapPage />}
          {devToolsTab === 'task-runner' && <RunDeskPage />}
          {devToolsTab === 'fleet' && <FleetPage />}
          {devToolsTab === 'workspaces' && <WorkspacesPage />}
          {devToolsTab === 'skills' && <SkillsManagerPage />}
        </Suspense>
      </div>
    </div>
  );
}
