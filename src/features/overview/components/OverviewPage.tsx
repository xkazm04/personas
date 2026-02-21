import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import GlobalExecutionList from '@/features/overview/sub_executions/GlobalExecutionList';
import ManualReviewList from '@/features/overview/sub_manual-review/ManualReviewList';
import MessageList from '@/features/overview/sub_messages/MessageList';
import EventLogList from '@/features/overview/sub_events/EventLogList';
import { UsageDashboard } from '@/features/overview/sub_usage/UsageDashboard';
import ObservabilityDashboard from '@/features/overview/sub_observability/ObservabilityDashboard';
import MemoriesPage from '@/features/overview/sub_memories/MemoriesPage';
import RealtimeVisualizerPage from '@/features/overview/sub_realtime/RealtimeVisualizerPage';
import BudgetSettingsPage from '@/features/overview/sub_budget/BudgetSettingsPage';
import { SystemChecksPanel } from '@/features/agents/components/OnboardingWizard';

export default function OverviewPage() {
  const overviewTab = usePersonaStore((s) => s.overviewTab);

  return (
    <motion.div
      key={overviewTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 h-full overflow-hidden"
    >
      {overviewTab === 'system-check' ? <SystemChecksPanel /> :
       overviewTab === 'executions' ? <GlobalExecutionList /> :
       overviewTab === 'manual-review' ? <ManualReviewList /> :
       overviewTab === 'messages' ? <MessageList /> :
       overviewTab === 'events' ? <EventLogList /> :
       overviewTab === 'usage' ? <UsageDashboard /> :
       overviewTab === 'observability' ? <ObservabilityDashboard /> :
       overviewTab === 'realtime' ? <RealtimeVisualizerPage /> :
       overviewTab === 'memories' ? <MemoriesPage /> :
       overviewTab === 'budget' ? <BudgetSettingsPage /> :
       <GlobalExecutionList />}
    </motion.div>
  );
}
