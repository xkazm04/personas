import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import DashboardHome from '@/features/overview/components/DashboardHome';
import GlobalExecutionList from '@/features/overview/sub_executions/GlobalExecutionList';
import ManualReviewList from '@/features/overview/sub_manual-review/ManualReviewList';
import MessageList from '@/features/overview/sub_messages/MessageList';
import EventLogList from '@/features/overview/sub_events/EventLogList';
import MemoriesPage from '@/features/overview/sub_memories/MemoriesPage';
import RealtimeVisualizerPage from '@/features/overview/sub_realtime/RealtimeVisualizerPage';
import BudgetSettingsPage from '@/features/overview/sub_budget/BudgetSettingsPage';
import KnowledgeGraphDashboard from '@/features/overview/sub_knowledge/KnowledgeGraphDashboard';
import SLADashboard from '@/features/overview/sub_sla/SLADashboard';
import WorkflowsDashboard from '@/features/overview/sub_workflows/WorkflowsDashboard';
import TierUsageDashboard from '@/features/overview/sub_tier/TierUsageDashboard';
import CronAgentsPage from '@/features/overview/sub_cron_agents/CronAgentsPage';
import { OverviewFilterProvider } from '@/features/overview/components/OverviewFilterContext';
import AnalyticsDashboard from '@/features/overview/sub_analytics/AnalyticsDashboard';

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
        {overviewTab === 'home' ? <DashboardHome /> :
        overviewTab === 'executions' ? <GlobalExecutionList /> :
        overviewTab === 'manual-review' ? <ManualReviewList /> :
        overviewTab === 'messages' ? <MessageList /> :
        overviewTab === 'events' ? <EventLogList /> :
        overviewTab === 'analytics' || overviewTab === 'usage' || overviewTab === 'observability' ? (
          <AnalyticsDashboard />
        ) :
        overviewTab === 'realtime' ? <RealtimeVisualizerPage /> :
        overviewTab === 'memories' ? <MemoriesPage /> :
        overviewTab === 'knowledge' ? <KnowledgeGraphDashboard /> :
        overviewTab === 'budget' ? <BudgetSettingsPage /> :
        overviewTab === 'sla' ? <SLADashboard /> :
        overviewTab === 'workflows' ? <WorkflowsDashboard /> :
        overviewTab === 'tier' ? <TierUsageDashboard /> :
        overviewTab === 'cron-agents' ? <CronAgentsPage /> :
        <DashboardHome />}
      </motion.div>
    </OverviewFilterProvider>
  );
}
