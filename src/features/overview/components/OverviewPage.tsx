import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import DashboardHome from '@/features/overview/components/DashboardHome';
import GlobalExecutionList from '@/features/overview/sub_executions/GlobalExecutionList';
import ManualReviewList from '@/features/overview/sub_manual-review/ManualReviewList';
import MessageList from '@/features/overview/sub_messages/MessageList';
import EventLogList from '@/features/overview/sub_events/EventLogList';
import MemoriesPage from '@/features/overview/sub_memories/MemoriesPage';
import RealtimeVisualizerPage from '@/features/overview/sub_realtime/RealtimeVisualizerPage';
import BudgetSettingsPage from '@/features/overview/sub_budget/BudgetSettingsPage';
import { SystemHealthPanel } from '@/features/overview/components/SystemHealthPanel';
import KnowledgeGraphDashboard from '@/features/overview/sub_knowledge/KnowledgeGraphDashboard';

const AnalyticsDashboard = lazy(() => import('@/features/overview/sub_analytics/AnalyticsDashboard'));

function LazyFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
    </div>
  );
}

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
       overviewTab === 'analytics' || overviewTab === 'usage' || overviewTab === 'observability' ? (
         <Suspense fallback={<LazyFallback />}><AnalyticsDashboard /></Suspense>
       ) :
       overviewTab === 'realtime' ? <RealtimeVisualizerPage /> :
       overviewTab === 'memories' ? <MemoriesPage /> :
       overviewTab === 'knowledge' ? <KnowledgeGraphDashboard /> :
       overviewTab === 'budget' ? <BudgetSettingsPage /> :
       <DashboardHome />}
    </motion.div>
  );
}
