import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useOverviewStore } from "@/stores/overviewStore";
import { OverviewFilterProvider } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useExecutionDashboardPipeline } from '@/hooks/overview/useExecutionDashboardPipeline';
import PanelSkeleton from '@/features/shared/components/layout/PanelSkeleton';

// Lazy-load each subtab -- only the active one ships to the render tree.
// On Desktop these become separate chunks; on Android inlineDynamicImports
// collapses them into the IIFE so the Suspense resolves in one microtask.
const DashboardWithSubtabs = lazy(() => import('@/features/overview/components/dashboard/DashboardWithSubtabs'));
const ExecutionsWithSubtabs = lazy(() => import('@/features/overview/components/dashboard/ExecutionsWithSubtabs'));
const ManualReviewList = lazy(() => import('@/features/overview/sub_manual-review/components/ManualReviewList'));
const MessageList = lazy(() => import('@/features/overview/sub_messages/components/MessageList'));
const EventLogList = lazy(() => import('@/features/overview/sub_events/components/EventLogList'));
const KnowledgeHub = lazy(() => import('@/features/overview/components/dashboard/cards/KnowledgeHub'));
const SLADashboard = lazy(() => import('@/features/overview/sub_sla/components/SLADashboard'));
const ScheduleTimeline = lazy(() => import('@/features/overview/sub_schedules/components/ScheduleTimeline'));
const PersonaHealthDashboard = lazy(() => import('@/features/overview/sub_health/components/PersonaHealthDashboard'));

function OverviewContent() {
  useExecutionDashboardPipeline();
  const overviewTab = useOverviewStore((s) => s.overviewTab);

  return (
    <motion.div
      key={overviewTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
    >
      <Suspense fallback={<PanelSkeleton variant="section" />}>
        {overviewTab === 'home' ? <DashboardWithSubtabs /> :
        overviewTab === 'executions' ? <ExecutionsWithSubtabs /> :
        overviewTab === 'manual-review' ? <ManualReviewList /> :
        overviewTab === 'messages' ? <MessageList /> :
        overviewTab === 'events' ? <EventLogList /> :
        overviewTab === 'knowledge' ? <KnowledgeHub /> :
        overviewTab === 'sla' ? <SLADashboard /> :
        overviewTab === 'schedules' ? <ScheduleTimeline /> :
        overviewTab === 'health' ? <PersonaHealthDashboard /> :
        <DashboardWithSubtabs />}
      </Suspense>
    </motion.div>
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
