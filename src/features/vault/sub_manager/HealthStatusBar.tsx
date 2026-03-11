import { useMemo } from 'react';
import { HeartPulse, Loader2, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/hooks/health/useBulkHealthcheck';

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

  const isSimple = useSimpleMode();
  if (credentials.length === 0 || isSimple) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 bg-secondary/20 border-b border-primary/10">
      {/* Health counts */}
      <div className="flex items-center gap-4 text-sm">
        {counts.healthy > 0 && (
          <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            <span className="font-medium">{counts.healthy}</span>
            <span className="text-foreground/50">healthy</span>
          </span>
        )}
        {counts.failing > 0 && (
          <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
            <AlertCircle className="w-3 h-3" />
            <span className="font-medium">{counts.failing}</span>
            <span className="text-foreground/50">needs attention</span>
          </span>
        )}
        {counts.untested > 0 && (
          <span className="flex items-center gap-1.5 text-foreground/60">
            <HelpCircle className="w-3 h-3" />
            <span className="font-medium">{counts.untested}</span>
            <span className="text-foreground/50">untested</span>
          </span>
        )}
      </div>

      {/* Test All button */}
      <button
        onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium border transition-colors ${
          bulk.isRunning
            ? 'bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/25 dark:border-amber-500/20'
            : bulk.summary
              ? bulk.summary.failed > 0
                ? 'bg-red-600/15 text-red-700 dark:text-red-400 border-red-600/25 dark:border-red-500/20'
                : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/25 dark:border-emerald-500/20'
              : 'border-violet-600/25 dark:border-violet-500/20 text-violet-700 dark:text-violet-400/80 hover:bg-violet-600/10 dark:hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-400'
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
