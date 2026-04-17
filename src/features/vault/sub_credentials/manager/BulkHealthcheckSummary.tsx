import { AlertTriangle, CheckCircle2, Clock, HeartPulse, X, XCircle } from 'lucide-react';
import type { BulkSummary } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';
import { useTranslation } from '@/i18n/useTranslation';

interface BulkHealthcheckSummaryProps {
  summary: BulkSummary | null;
  onDismiss: () => void;
}

export function BulkHealthcheckSummary({ summary, onDismiss }: BulkHealthcheckSummaryProps) {
  const { t, tx } = useTranslation();
  const bh = t.vault.bulk_healthcheck;
  return (
    <>
      {summary && (
        <div
          className="animate-fade-slide-in overflow-hidden"
        >
          <div className="rounded-modal border border-primary/15 bg-secondary/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="typo-heading font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
                <div className="p-1.5 rounded-card bg-violet-500/10 text-violet-400">
                  <HeartPulse className="w-3.5 h-3.5" />
                </div>
                {bh.title}
              </h4>
              <button
                onClick={onDismiss}
                className="p-1 hover:bg-secondary/60 rounded-card transition-colors"
                title={t.common.dismiss}
              >
                <X className="w-3.5 h-3.5 text-foreground" />
              </button>
            </div>

            <div className="flex items-center gap-4 typo-body">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {tx(bh.passed_count, { count: summary.passed })}
              </span>
              {summary.failed > 0 && (
                <span className="flex items-center gap-1.5 text-red-400">
                  <XCircle className="w-3.5 h-3.5" />
                  {tx(bh.failed_count, { count: summary.failed })}
                </span>
              )}
              <span className="text-foreground">
                {tx(bh.total_count, { count: summary.total })}
              </span>
            </div>

            {summary.needsAttention.length > 0 && (
              <div className="space-y-1.5">
                <div className="typo-body font-medium text-red-400/80 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> {bh.needs_attention}
                </div>
                {summary.needsAttention.map((r) => (
                  <div
                    key={r.credentialId}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-modal bg-red-500/5 border border-red-500/10 typo-body"
                  >
                    <span className="text-foreground truncate">{r.credentialName}</span>
                    <span className="text-red-400/70 typo-body truncate max-w-[200px]" title={r.message}>
                      {r.message}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {summary.slowest.length > 0 && (
              <div className="space-y-1.5">
                <div className="typo-body font-medium text-foreground flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> {bh.slowest_responses}
                </div>
                <div className="flex items-center gap-3 typo-body text-foreground">
                  {summary.slowest.map((r) => (
                    <span key={r.credentialId} className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${r.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="truncate max-w-[120px]">{r.credentialName}</span>
                      <span className="typo-code text-foreground font-mono">
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
