import { AlertTriangle, CheckCircle2, Clock, HeartPulse, X, XCircle } from 'lucide-react';
import type { BulkSummary } from '@/features/vault/hooks/health/useBulkHealthcheck';

interface BulkHealthcheckSummaryProps {
  summary: BulkSummary | null;
  onDismiss: () => void;
}

export function BulkHealthcheckSummary({ summary, onDismiss }: BulkHealthcheckSummaryProps) {
  return (
    <>
      {summary && (
        <div
          className="animate-fade-slide-in overflow-hidden"
        >
          <div className="rounded-xl border border-primary/15 bg-secondary/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-widest text-foreground/80 flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400">
                  <HeartPulse className="w-3.5 h-3.5" />
                </div>
                Healthcheck Results
              </h4>
              <button
                onClick={onDismiss}
                className="p-1 hover:bg-secondary/60 rounded-lg transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground/60" />
              </button>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {summary.passed} passed
              </span>
              {summary.failed > 0 && (
                <span className="flex items-center gap-1.5 text-red-400">
                  <XCircle className="w-3.5 h-3.5" />
                  {summary.failed} failed
                </span>
              )}
              <span className="text-muted-foreground/60">
                {summary.total} total
              </span>
            </div>

            {summary.needsAttention.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-red-400/80 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Needs Attention
                </div>
                {summary.needsAttention.map((r) => (
                  <div
                    key={r.credentialId}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-red-500/5 border border-red-500/10 text-sm"
                  >
                    <span className="text-foreground/80 truncate">{r.credentialName}</span>
                    <span className="text-red-400/70 text-sm truncate max-w-[200px]" title={r.message}>
                      {r.message}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {summary.slowest.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-muted-foreground/60 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Slowest Responses
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground/80">
                  {summary.slowest.map((r) => (
                    <span key={r.credentialId} className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${r.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="truncate max-w-[120px]">{r.credentialName}</span>
                      <span className="text-sm text-muted-foreground/50 font-mono">
                        {r.durationMs < 1000 ? `${Math.round(r.durationMs)}ms` : `${(r.durationMs / 1000).toFixed(1)}s`}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
