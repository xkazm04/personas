import { Suspense, useState, startTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, BarChart3, Radio } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import DashboardHome from '@/features/overview/components/dashboard/DashboardHome';
import { lazyRetry } from '@/lib/lazyRetry';

// DashboardHome is the default view -- keep it eager for instant first paint.
// Analytics (recharts-heavy) and Realtime (d3/svg-heavy) are lazy.
const AnalyticsDashboard = lazyRetry(() => import('@/features/overview/sub_analytics/components/AnalyticsDashboard'));
const RealtimeVisualizerPage = lazyRetry(() => import('@/features/overview/sub_realtime/components/views/RealtimeVisualizerPage'));

type DashboardSubtab = 'overview' | 'analytics' | 'realtime';

const SUBTABS: Array<{ id: DashboardSubtab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'realtime', label: 'Realtime', icon: Radio },
];

export default function DashboardWithSubtabs() {
  const [subtab, setSubtab] = useState<DashboardSubtab>('overview');

  const handleTabSwitch = (id: DashboardSubtab) => {
    startTransition(() => setSubtab(id));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Subtab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subtab === tab.id;
          return (
            <Button
              key={tab.id}
              variant={isActive ? 'secondary' : 'ghost'}
              size="sm"
              icon={<Icon className="w-3.5 h-3.5" />}
              onClick={() => handleTabSwitch(tab.id)}
              className={isActive
                ? 'bg-primary/10 text-foreground border border-primary/20 shadow-sm'
                : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/40'}
            >
              {tab.label}
            </Button>
          );
        })}
      </div>

      {/* Content -- DashboardHome is eager, others lazy */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={subtab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 min-h-0 flex flex-col"
        >
          {subtab === 'overview' ? (
            <ErrorBoundary name="Dashboard/overview">
              <DashboardHome />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary name={`Dashboard/${subtab}`}>
              <Suspense fallback={null}>
                {subtab === 'analytics' ? <AnalyticsDashboard /> : <RealtimeVisualizerPage />}
              </Suspense>
            </ErrorBoundary>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
