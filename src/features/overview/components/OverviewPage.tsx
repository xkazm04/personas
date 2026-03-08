import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import DashboardWithSubtabs from '@/features/overview/components/DashboardWithSubtabs';
import ExecutionsWithSubtabs from '@/features/overview/components/ExecutionsWithSubtabs';
import ManualReviewList from '@/features/overview/sub_manual-review/ManualReviewList';
import MessageList from '@/features/overview/sub_messages/MessageList';
import EventLogList from '@/features/overview/sub_events/EventLogList';
import KnowledgeHub from '@/features/overview/components/KnowledgeHub';
import SLADashboard from '@/features/overview/sub_sla/SLADashboard';
import CronAgentsPage from '@/features/overview/sub_cron_agents/CronAgentsPage';
import { OverviewFilterProvider } from '@/features/overview/components/OverviewFilterContext';

export default function OverviewPage() {
  const overviewTab = usePersonaStore((s) => s.overviewTab);

  return (
    <OverviewFilterProvider>
      <motion.div
        key={overviewTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {overviewTab === 'home' ? <DashboardWithSubtabs /> :
        overviewTab === 'executions' ? <ExecutionsWithSubtabs /> :
        overviewTab === 'manual-review' ? <ManualReviewList /> :
        overviewTab === 'messages' ? <MessageList /> :
        overviewTab === 'events' ? <EventLogList /> :
        overviewTab === 'knowledge' ? <KnowledgeHub /> :
        overviewTab === 'sla' ? <SLADashboard /> :
        overviewTab === 'cron-agents' ? <CronAgentsPage /> :
        <DashboardWithSubtabs />}
      </motion.div>
    </OverviewFilterProvider>
  );
}
