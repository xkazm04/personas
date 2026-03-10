import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

export function ErrorBanner({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-300">Metrics unavailable</p>
          <p className="text-sm text-red-400/70 mt-0.5">{error}</p>
        </div>
        <button onClick={onRetry} className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost anomaly alerts
// ---------------------------------------------------------------------------

export function CostAnomalyAlerts({ anomalies }: { anomalies: DashboardCostAnomaly[] }) {
  if (anomalies.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">
            {anomalies.length} cost anomal{anomalies.length === 1 ? 'y' : 'ies'} detected
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {anomalies.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm border bg-amber-500/15 text-amber-300 border-amber-500/25">
                {new Date(a.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                <span className="font-mono text-sm opacity-80">${a.cost.toFixed(2)}</span>
                <span className="font-mono text-sm font-bold text-amber-400">{a.deviation_sigma.toFixed(1)}&sigma;</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
