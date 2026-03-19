import { Activity, Zap, AlertCircle, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { AnimatedList } from '@/features/shared/components/display/AnimatedList';

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
    <div className="lg:col-span-2 2xl:col-span-3 space-y-4">
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

      <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden divide-y divide-primary/5">
        {recentExecs.length > 0 ? (
          <AnimatedList
            className="divide-y divide-primary/5"
            keys={recentExecs.map((e) => e.id)}
          >
            {recentExecs.map((exec) => (
              <div key={exec.id} className="px-3 py-1.5 flex items-center gap-2.5 hover:bg-white/[0.03] transition-colors group cursor-pointer" onClick={onViewAll}>
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  exec.status === 'completed' ? 'text-emerald-400' :
                  exec.status === 'failed' ? 'text-rose-400' :
                  'text-blue-400'
                }`}>
                  {exec.status === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                   exec.status === 'failed' ? <AlertCircle className="w-3.5 h-3.5" /> :
                   <Activity className="w-3.5 h-3.5 animate-pulse" />}
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
          <div className="p-8 text-center flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-xl bg-secondary/50 border border-primary/10 shadow-inner flex items-center justify-center mb-4 opacity-70">
              <Zap className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="typo-heading text-foreground/70">No recent activity found.</p>
            <p className="typo-body text-muted-foreground mt-1">Run an agent to see activity here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
