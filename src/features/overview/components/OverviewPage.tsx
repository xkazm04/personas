import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import DashboardHome from '@/features/overview/components/DashboardHome';
import GlobalExecutionList from '@/features/overview/sub_executions/GlobalExecutionList';
import ManualReviewList from '@/features/overview/sub_manual-review/ManualReviewList';
import MessageList from '@/features/overview/sub_messages/MessageList';
import EventLogList from '@/features/overview/sub_events/EventLogList';
import { UsageDashboard } from '@/features/overview/sub_usage/UsageDashboard';
import ObservabilityDashboard from '@/features/overview/sub_observability/ObservabilityDashboard';
import MemoriesPage from '@/features/overview/sub_memories/MemoriesPage';
import RealtimeVisualizerPage from '@/features/overview/sub_realtime/RealtimeVisualizerPage';
import BudgetSettingsPage from '@/features/overview/sub_budget/BudgetSettingsPage';
import { SystemHealthPanel } from '@/features/overview/components/SystemHealthPanel';

export default function OverviewPage() {
  const overviewTab = usePersonaStore((s) => s.overviewTab);

  return (
    <motion.div
      key={overviewTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      {overviewTab === 'home' ? <DashboardHome /> :
       overviewTab === 'system-check' ? <SystemHealthPanel /> :
       overviewTab === 'executions' ? <GlobalExecutionList /> :
       overviewTab === 'manual-review' ? <ManualReviewList /> :
       overviewTab === 'messages' ? <MessageList /> :
       overviewTab === 'events' ? <EventLogList /> :
       overviewTab === 'usage' ? <UsageDashboard /> :
       overviewTab === 'observability' ? <ObservabilityDashboard /> :
       overviewTab === 'realtime' ? <RealtimeVisualizerPage /> :
       overviewTab === 'memories' ? <MemoriesPage /> :
       overviewTab === 'budget' ? <BudgetSettingsPage /> :
       <DashboardHome />}
    </motion.div>
  );
}
