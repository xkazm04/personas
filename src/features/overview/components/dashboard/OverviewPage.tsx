import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOverviewStore } from "@/stores/overviewStore";
import { OverviewFilterProvider } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useExecutionDashboardPipeline } from '@/hooks/overview/useExecutionDashboardPipeline';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { ContentBox, ContentBody } from '@/features/shared/components/layout/ContentLayout';
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
const KnowledgeHub = lazyRetry(() => import('@/features/overview/components/dashboard/cards/KnowledgeHub'));
const SLADashboard = lazyRetry(() => import('@/features/overview/sub_sla/components/SLADashboard'));

const PersonaHealthDashboard = lazyRetry(() => import('@/features/overview/sub_health/components/PersonaHealthDashboard'));
const LeaderboardPage = lazyRetry(() => import('@/features/overview/sub_leaderboard'));
const IncidentsInbox = lazyRetry(() => import('@/features/overview/sub_incidents'));
const DirectorCoachingTab = lazyRetry(() => import('@/features/overview/sub_director'));

/** Pulsing panel placeholder matching the dashboard's card geometry. */
function SkeletonPanel({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-modal border border-primary/10 bg-secondary/[0.03] animate-pulse ${className}`}
    />
  );
}

/**
 * Suspense fallback for the overview routes. Paints the real header
 * chrome (via `ContentHeaderSkeleton`) plus a card-shaped body skeleton
 * in the first frame, so switching tabs no longer flashes a bare spinner
 * — the page frame is present immediately while the lazy chunk loads.
 */
function OverviewRouteSkeleton() {
  return (
    <ContentBox>
      <ContentHeaderSkeleton showActions />
      <ContentBody centered>
        <div className="space-y-4 pb-6 pt-2">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_1fr_minmax(280px,340px)] gap-4">
            <SkeletonPanel className="h-72" />
            <SkeletonPanel className="h-72" />
            <SkeletonPanel className="h-72" />
          </div>
          <SkeletonPanel className="h-11" />
          <SkeletonPanel className="h-44" />
        </div>
      </ContentBody>
    </ContentBox>
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
          overviewTab === 'knowledge' ? <KnowledgeHub /> :
          overviewTab === 'sla' ? <SLADashboard /> :

          overviewTab === 'health' ? <PersonaHealthDashboard /> :
          overviewTab === 'director' ? <DirectorCoachingTab /> :
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
