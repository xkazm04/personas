import { Suspense } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { useSystemStore } from "@/stores/systemStore";
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { PortfolioStrip } from './components/PortfolioStrip';

const ProjectOverviewPage = lazyRetry(() => import('./sub_overview/ProjectOverviewPage'));
const LlmOverviewPage = lazyRetry(() => import('./sub_llm_overview/LlmOverviewPage'));
const ContextMapPage = lazyRetry(() => import('./sub_context/ContextMapPage'));
const RunDeskPage = lazyRetry(() => import('./sub_runner/RunDeskPage'));
const FleetPage = lazyRetry(() => import('@/features/plugins/fleet/FleetPage'));
const WorkspacesPage = lazyRetry(() => import('./sub_workspaces/WorkspacesPage'));
const SkillsManagerPage = lazyRetry(() => import('./sub_skills/SkillsManagerPage'));

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
        {/* Cross-project answer above the per-project page. Outside the
            Suspense boundary so it paints without waiting on the route chunk,
            and it hides itself when there is no portfolio to summarise. */}
        {devToolsTab === 'overview' && (
          <div className="px-4 pt-3 shrink-0">
            <PortfolioStrip />
          </div>
        )}
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
