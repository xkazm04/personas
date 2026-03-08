import { useMemo } from 'react';
import { HeartPulse, Loader2, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/hooks/useBulkHealthcheck';

interface HealthStatusBarProps {
  credentials: CredentialMetadata[];
  bulk: ReturnType<typeof useBulkHealthcheck>;
  isDailyRun?: boolean;
}

export function HealthStatusBar({ credentials, bulk, isDailyRun }: HealthStatusBarProps) {
  const counts = useMemo(() => {
    let healthy = 0;
    let failing = 0;
    let untested = 0;
    for (const cred of credentials) {
      if (cred.healthcheck_last_success === null || cred.healthcheck_last_success === undefined) {
        untested++;
      } else if (cred.healthcheck_last_success) {
        healthy++;
      } else {
        failing++;
      }
    }
    return { healthy, failing, untested };
  }, [credentials]);

  if (credentials.length === 0) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 bg-secondary/20 border-b border-primary/10">
      {/* Health counts */}
      <div className="flex items-center gap-4 text-sm">
        {counts.healthy > 0 && (
          <span className="flex items-center gap-1.5 text-emerald-400/80">
            <CheckCircle2 className="w-3 h-3" />
            <span className="font-medium">{counts.healthy}</span>
            <span className="text-muted-foreground/60">healthy</span>
          </span>
        )}
        {counts.failing > 0 && (
          <span className="flex items-center gap-1.5 text-red-400/80">
            <AlertCircle className="w-3 h-3" />
            <span className="font-medium">{counts.failing}</span>
            <span className="text-muted-foreground/60">needs attention</span>
          </span>
        )}
        {counts.untested > 0 && (
          <span className="flex items-center gap-1.5 text-muted-foreground/50">
            <HelpCircle className="w-3 h-3" />
            <span className="font-medium">{counts.untested}</span>
            <span className="text-muted-foreground/60">untested</span>
          </span>
        )}
      </div>

      {/* Test All button */}
      <button
        onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium border transition-colors ${
          bulk.isRunning
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            : bulk.summary
              ? bulk.summary.failed > 0
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'border-violet-500/20 text-violet-400/80 hover:bg-violet-500/10 hover:text-violet-400'
        }`}
        title={bulk.isRunning ? 'Cancel healthcheck' : 'Test all credentials'}
      >
        {bulk.isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : bulk.summary ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : (
          <HeartPulse className="w-3 h-3" />
        )}
        {bulk.isRunning
          ? isDailyRun
            ? `Daily check ${bulk.progress.done}/${bulk.progress.total}...`
            : `Testing ${bulk.progress.done}/${bulk.progress.total}...`
          : bulk.summary
            ? `${bulk.summary.passed} passed${bulk.summary.failed > 0 ? `, ${bulk.summary.failed} failed` : ''}`
            : 'Test All'}
      </button>
    </div>
  );
}
