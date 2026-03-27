import { Activity, AlertCircle, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { AnimatedList } from '@/features/shared/components/display/AnimatedList';
import { DASHBOARD_GRID_SPAN_MAJOR, CARD_CONTAINER } from '@/features/overview/utils/dashboardGrid';
import { EmptyState } from '@/features/shared/components/display/EmptyState';

interface Execution {
  id: string;
  status: string;
  persona_name?: string;
  created_at: string;
}

interface RecentActivityListProps {
  recentExecs: Execution[];
  onViewAll: () => void;
}

export function RecentActivityList({ recentExecs, onViewAll }: RecentActivityListProps) {
  return (
    <div className={`${DASHBOARD_GRID_SPAN_MAJOR} space-y-4`}>
      <div className="flex items-center justify-between px-1">
        <h3 className="typo-label text-muted-foreground/80 flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Recent Activity
        </h3>
        <button
          onClick={onViewAll}
          className="typo-heading text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
        >
          View All <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className={`${CARD_CONTAINER} overflow-hidden divide-y divide-primary/5`}>
        {recentExecs.length > 0 ? (
          <AnimatedList
            className="divide-y divide-primary/5"
            keys={recentExecs.map((e) => e.id)}
          >
            {recentExecs.map((exec) => (
              <div key={exec.id} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewAll(); } }} className="px-3 py-1.5 flex items-center gap-2.5 hover:bg-white/[0.03] transition-colors group cursor-pointer focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none" onClick={onViewAll}>
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  exec.status === 'completed' ? 'text-emerald-400' :
                  exec.status === 'failed' ? 'text-rose-400' :
                  'text-blue-400'
                }`}>
                  {exec.status === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                   exec.status === 'failed' ? <AlertCircle className="w-3.5 h-3.5" /> :
                   <Activity className="w-3.5 h-3.5 animate-pulse motion-reduce:animate-none" />}
                </div>
                <span className="typo-heading text-foreground/90 truncate min-w-0">{exec.persona_name || 'Agent'}</span>
                <span className={`typo-heading px-1.5 py-0.5 rounded-lg flex-shrink-0 ${
                  exec.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                  exec.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                  'bg-blue-500/10 text-blue-400'
                }`}>
                  {exec.status}
                </span>
                <span className="flex-1" />
                <span className="typo-body text-muted-foreground/60 flex-shrink-0 hidden sm:inline">
                  {new Date(exec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </AnimatedList>
        ) : (
          <EmptyState variant="activity" />
        )}
      </div>
    </div>
  );
}
