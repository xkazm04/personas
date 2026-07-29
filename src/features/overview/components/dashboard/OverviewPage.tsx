import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOverviewStore } from "@/stores/overviewStore";
import { OverviewFilterProvider } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useExecutionDashboardPipeline } from '@/hooks/overview/useExecutionDashboardPipeline';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { ContentHeaderSkeleton } from '@/features/shared/components/layout/ContentHeaderSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';
import { pageTransition } from '@/features/overview/libs/animations';

// Lazy-load each subtab -- only the active one ships to the render tree.
// On Desktop these become separate chunks; on Android inlineDynamicImports
// collapses them into the IIFE so the Suspense resolves in one microtask.
const DashboardWithSubtabs = lazyRetry(() => import('@/features/overview/components/dashboard/DashboardWithSubtabs'));
const ExecutionsWithSubtabs = lazyRetry(() => import('@/features/overview/components/dashboard/ExecutionsWithSubtabs'));
const ManualReviewList = lazyRetry(() => import('@/features/overview/sub_manual-review/components/ManualReviewList'));
const MessageList = lazyRetry(() => import('@/features/overview/sub_messages/components/MessageList'));
const EventLogList = lazyRetry(() => import('@/features/overview/sub_events/components/EventLogList'));
// The four former "Knowledge" subtabs. KnowledgeHub (the SegmentedTabs shell
// that used to wrap them) was deleted on 2026-07-29 — the sidebar is the
// navigation now, so each view is routed directly.
const MemoriesPage = lazyRetry(() => import('@/features/overview/sub_memories/components/MemoriesPage'));
const PatternsPanel = lazyRetry(() => import('@/features/overview/sub_patterns/PatternsPanel'));
const KnowledgeGraphDashboard = lazyRetry(() => import('@/features/overview/sub_knowledge'));
const MemoriesPageGraph = lazyRetry(() => import('@/features/overview/sub_memories/components/MemoriesPageGraph'));
const SLADashboard = lazyRetry(() => import('@/features/overview/sub_sla/components/SLADashboard'));

const PersonaHealthDashboard = lazyRetry(() => import('@/features/overview/sub_health/components/PersonaHealthDashboard'));
const CertificationCommandCenter = lazyRetry(() => import('@/features/overview/sub_certification/CertificationCommandCenter'));
const LeaderboardPage = lazyRetry(() => import('@/features/overview/sub_leaderboard'));
const IncidentsInbox = lazyRetry(() => import('@/features/overview/sub_incidents'));
const DirectorCoachingTab = lazyRetry(() => import('@/features/overview/sub_director'));

/**
 * Suspense fallback while a tab's lazy chunk loads (hard refresh / first visit).
 *
 * Two rules (docs/design/overview-loading.md):
 * - **Invisible unless the chunk is genuinely slow.** The whole fallback sits
 *   behind a 150ms `animation-delay` with `fill-mode: both`, so a warm chunk
 *   resolves before a single pixel of it paints — no flash on tab switches.
 * - **Never fake the incoming layout.** Only the header band ghosts in: it is
 *   the one region every tab shares at the same position, so the swap to the
 *   real ContentHeader moves nothing. Body placeholders (the old three-panel
 *   dashboard silhouette) lied about every non-dashboard tab's geometry and
 *   produced exactly the skeleton→content blink this design forbids.
 */
function OverviewRouteSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex-1 min-h-0 flex flex-col animate-fade-in"
      style={{ animationDelay: '150ms' }}
    >
      <ContentBox>
        <ContentHeaderSkeleton showActions calm />
      </ContentBox>
    </div>
  );
}

function OverviewContent() {
  useExecutionDashboardPipeline();
  const overviewTab = useOverviewStore((s) => s.overviewTab);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={overviewTab}
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
      >
        <ErrorBoundary name={`Overview/${overviewTab}`}>
        <Suspense fallback={<OverviewRouteSkeleton />}>
          {overviewTab === 'home' ? <DashboardWithSubtabs /> :
          overviewTab === 'incidents' ? <IncidentsInbox /> :
          overviewTab === 'executions' ? <ExecutionsWithSubtabs /> :
          overviewTab === 'manual-review' ? <ManualReviewList /> :
          overviewTab === 'messages' ? <MessageList /> :
          overviewTab === 'events' ? <EventLogList /> :
          overviewTab === 'memories' ? <MemoriesPage /> :
          overviewTab === 'patterns' ? <PatternsPanel /> :
          overviewTab === 'extracted' ? <KnowledgeGraphDashboard /> :
          overviewTab === 'memory-graph' ? <MemoriesPageGraph /> :
          overviewTab === 'sla' ? <SLADashboard /> :

          overviewTab === 'health' ? <PersonaHealthDashboard /> :
          overviewTab === 'director' ? <DirectorCoachingTab /> :
          overviewTab === 'certification' ? <CertificationCommandCenter /> :
          overviewTab === 'leaderboard' ? <LeaderboardPage /> :
          <DashboardWithSubtabs />}
        </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

export default function OverviewPage() {
  return (
    <OverviewFilterProvider>
      <div data-testid="overview-page" className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
        <OverviewContent />
      </div>
    </OverviewFilterProvider>
  );
}
