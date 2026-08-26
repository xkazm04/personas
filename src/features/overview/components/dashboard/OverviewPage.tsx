import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOverviewStore } from "@/stores/overviewStore";
import { OverviewFilterProvider } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useExecutionDashboardPipeline } from '@/hooks/overview/useExecutionDashboardPipeline';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { lazyRetry } from '@/lib/lazyRetry';
import { pageTransition } from '@/features/overview/libs/animations';

// Lazy-load each subtab -- only the active one ships to the render tree.
// On Desktop these become separate chunks; on Android inlineDynamicImports
// collapses them into the IIFE so the Suspense resolves in one microtask.
const DashboardWithSubtabs = lazyRetry(() => import('@/features/overview/components/dashboard/DashboardWithSubtabs'));
const ExecutionsWithSubtabs = lazyRetry(() => import('@/features/overview/components/dashboard/ExecutionsWithSubtabs'));
const ManualReviewList = lazyRetry(() => import('@/features/overview/sub_manual-review/components/ManualReviewList'));
const ReportList = lazyRetry(() => import('@/features/overview/sub_reports/components/ReportList'));
const EventLogList = lazyRetry(() => import('@/features/overview/sub_events/components/EventLogList'));
// The four former "Knowledge" subtabs. KnowledgeHub (the SegmentedTabs shell
// that used to wrap them) was deleted on 2026-07-29 — the sidebar is the
// navigation now, so each view is routed directly.
const MemoriesPage = lazyRetry(() => import('@/features/overview/sub_memories/components/MemoriesPage'));
const PatternsPanel = lazyRetry(() => import('@/features/overview/sub_patterns/PatternsPanel'));
// The 'extracted' tab (execution-extracted knowledge graph) was retired 2026-08-26.
const MemoriesPageGraph = lazyRetry(() => import('@/features/overview/sub_memories/components/MemoriesPageGraph'));
// The former Reliability (SLA), Health and Leaderboard tabs were consolidated
// into Mission Control (2026-08-25) — their best sections render there now.
const CertificationCommandCenter = lazyRetry(() => import('@/features/overview/sub_certification/CertificationCommandCenter'));
const IncidentsInbox = lazyRetry(() => import('@/features/overview/sub_incidents'));
const DirectorCoachingTab = lazyRetry(() => import('@/features/overview/sub_director'));

/**
 * Suspense fallback while a tab's lazy chunk loads (hard refresh / first visit).
 *
 * No skeleton and no delay (2026-08-26): the header band is real chrome —
 * its content comes from code, not a fetch — so the fallback paints the
 * empty header band immediately at its true height, and the resolved tab
 * fills in title/subtitle/actions in place. Placeholder bars only added a
 * ghost→text swap on a region that was never waiting on data; the 150ms
 * hold just made a blank gap on a genuinely cold chunk. Only the header
 * ghosts — never the incoming body (docs/design/overview-loading.md §D).
 */
function OverviewRouteSkeleton() {
  return (
    <div aria-hidden="true" className="flex-1 min-h-0 flex flex-col">
      <ContentBox>
        <ContentHeader title="" />
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
          overviewTab === 'messages' ? <ReportList /> :
          overviewTab === 'events' ? <EventLogList /> :
          overviewTab === 'memories' ? <MemoriesPage /> :
          overviewTab === 'patterns' ? <PatternsPanel /> :
          overviewTab === 'memory-graph' ? <MemoriesPageGraph /> :
          overviewTab === 'director' ? <DirectorCoachingTab /> :
          overviewTab === 'certification' ? <CertificationCommandCenter /> :
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
