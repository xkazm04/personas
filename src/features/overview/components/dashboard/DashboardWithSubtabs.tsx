import { useState } from 'react';
import { LayoutDashboard, BarChart3, Radio } from 'lucide-react';
import DashboardHome from '@/features/overview/components/dashboard/DashboardHome';
import AnalyticsDashboard from '@/features/overview/sub_analytics/components/AnalyticsDashboard';
import RealtimeVisualizerPage from '@/features/overview/sub_realtime/components/RealtimeVisualizerPage';

type DashboardSubtab = 'overview' | 'analytics' | 'realtime';

const SUBTABS: Array<{ id: DashboardSubtab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'realtime', label: 'Realtime', icon: Radio },
];

export default function DashboardWithSubtabs() {
  const [subtab, setSubtab] = useState<DashboardSubtab>('overview');

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Subtab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subtab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubtab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary/10 text-foreground border border-primary/20 shadow-sm'
                  : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {subtab === 'overview' ? <DashboardHome /> :
       subtab === 'analytics' ? <AnalyticsDashboard /> :
       <RealtimeVisualizerPage />}
    </div>
  );
}
