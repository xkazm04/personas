import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import DashboardWithSubtabs from '@/features/overview/components/dashboard/DashboardWithSubtabs';
import ExecutionsWithSubtabs from '@/features/overview/components/dashboard/ExecutionsWithSubtabs';
import ManualReviewList from '@/features/overview/sub_manual-review/components/ManualReviewList';
import MessageList from '@/features/overview/sub_messages/components/MessageList';
import EventLogList from '@/features/overview/sub_events/components/EventLogList';
import KnowledgeHub from '@/features/overview/components/dashboard/cards/KnowledgeHub';
import SLADashboard from '@/features/overview/sub_sla/components/SLADashboard';
import CronAgentsPage from '@/features/overview/sub_cron_agents/components/CronAgentsPage';
import ScheduleTimeline from '@/features/overview/sub_schedules/components/ScheduleTimeline';
import { OverviewFilterProvider } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useExecutionDashboardPipeline } from '@/hooks/overview/useExecutionDashboardPipeline';

function OverviewContent() {
  useExecutionDashboardPipeline();
  const overviewTab = usePersonaStore((s) => s.overviewTab);

  return (
    <motion.div
      key={overviewTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
    >
      {overviewTab === 'home' ? <DashboardWithSubtabs /> :
      overviewTab === 'executions' ? <ExecutionsWithSubtabs /> :
      overviewTab === 'manual-review' ? <ManualReviewList /> :
      overviewTab === 'messages' ? <MessageList /> :
      overviewTab === 'events' ? <EventLogList /> :
      overviewTab === 'knowledge' ? <KnowledgeHub /> :
      overviewTab === 'sla' ? <SLADashboard /> :
      overviewTab === 'cron-agents' ? <CronAgentsPage /> :
      overviewTab === 'schedules' ? <ScheduleTimeline /> :
      <DashboardWithSubtabs />}
    </motion.div>
  );
}

export default function OverviewPage() {
  return (
    <OverviewFilterProvider>
      <OverviewContent />
    </OverviewFilterProvider>
  );
}
