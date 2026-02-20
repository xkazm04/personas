import { RefreshCw, Loader2 } from 'lucide-react';

export interface CloudStatusPanelProps {
  status: {
    workerCounts: { idle: number; executing: number; disconnected: number };
    queueLength: number;
    activeExecutions: number;
    hasClaudeToken: boolean;
  } | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function CloudStatusPanel({ status, isLoading, onRefresh }: CloudStatusPanelProps) {
  if (!status && isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground/50">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!status) {
    return (
      <p className="text-sm text-muted-foreground/50 py-8 text-center">
        No status data available.
      </p>
    );
  }

  const workers = status.workerCounts;

  return (
    <div className="space-y-6">
      {/* Refresh button */}
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary/40 border border-primary/15 text-muted-foreground/60 hover:text-foreground/80 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Worker counts */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-3">
          Workers
        </h3>
        <div className="flex flex-wrap gap-3">
          <WorkerBadge label="Idle" count={workers.idle} color="emerald" />
          <WorkerBadge label="Executing" count={workers.executing} color="blue" />
          <WorkerBadge label="Disconnected" count={workers.disconnected} color="red" />
        </div>
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-3">
          Activity
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Queue Length" value={status.queueLength} />
          <StatCard label="Active Executions" value={status.activeExecutions} />
        </div>
      </div>

      {/* Claude token indicator */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-3">
          Claude Token
        </h3>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30 border border-primary/10">
          {status.hasClaudeToken ? (
            <>
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-foreground/80">Token available</span>
            </>
          ) : (
            <>
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <span className="text-sm text-foreground/80">No token configured</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerBadge({ label, count, color }: { label: string; count: number; color: 'emerald' | 'blue' | 'red' }) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colorMap[color]}`}>
      <span className="text-lg font-semibold">{count}</span>
      <span className="text-xs opacity-70">{label}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg bg-secondary/30 border border-primary/10">
      <p className="text-xs text-muted-foreground/50">{label}</p>
      <p className="text-xl font-semibold text-foreground/80 mt-1">{value}</p>
    </div>
  );
}
