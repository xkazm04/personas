import { useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  RefreshCw,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { FEASIBILITY_COLORS } from '@/lib/utils/designTokens';
import type { DryRunIssue, DryRunResult } from './types';
import type { UseHealthCheckReturn } from './useHealthCheck';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { ScoreBadge, ScoreRing } from './HealthScoreDisplay';
import { HealthIssueCard } from './HealthIssueCard';
import { useApplyHealthFix } from './useApplyHealthFix';

interface HealthCheckPanelProps {
  healthCheck: UseHealthCheckReturn;
}

export function HealthCheckPanel({ healthCheck }: HealthCheckPanelProps) {
  const { phase, result, score, error, runHealthCheck, markIssueResolved, reset } = healthCheck;
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const handleApplyFix = useApplyHealthFix();

  const handleRun = useCallback(async () => {
    if (!selectedPersona) return;
    await runHealthCheck(selectedPersona);
  }, [selectedPersona, runHealthCheck]);

  if (phase === 'idle') {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <Activity className="w-10 h-10 text-primary/40 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-foreground/80 mb-1">Agent Health Check</h3>
          <p className="text-sm text-muted-foreground/60 mb-4 max-w-sm mx-auto">
            Run a dry-run analysis against this agent's current configuration to detect missing credentials,
            disconnected connectors, and underspecified use cases.
          </p>
          <button
            type="button" onClick={handleRun} disabled={!selectedPersona}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40"
          >
            <Activity className="w-4 h-4" />
            Run Health Check
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    return <ContentLoader variant="panel" label="Running health check..." hint="health" />;
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/20">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">Health check failed</p>
              <p className="text-sm text-muted-foreground/60 mt-0.5">{error}</p>
            </div>
          </div>
        </div>
        <button
          type="button" onClick={() => { reset(); handleRun(); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  if (!result || !score) return null;

  const dryRun: DryRunResult = result.result;
  const statusTokens = (FEASIBILITY_COLORS[dryRun.status] ?? FEASIBILITY_COLORS['partial'])!;
  const remainingIssues = dryRun.issues.filter((i: DryRunIssue) => !i.resolved).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <ScoreRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ScoreBadge score={score} />
            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-medium ${statusTokens.bgColor} ${statusTokens.color} border ${statusTokens.borderColor}`}>
              {dryRun.status === 'ready' ? <CheckCircle2 className="w-3 h-3" /> : dryRun.status === 'blocked' ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {dryRun.status.charAt(0).toUpperCase() + dryRun.status.slice(1)}
            </div>
          </div>
          <p className="text-sm text-muted-foreground/60">
            {remainingIssues > 0 ? `${remainingIssues} issue${remainingIssues !== 1 ? 's' : ''} found` : 'No issues detected'}
            {' \u00b7 '}Checked {new Date(result.checkedAt).toLocaleTimeString()}
          </p>
        </div>
        <button type="button" onClick={handleRun}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-secondary/60 text-muted-foreground border border-primary/15 hover:bg-secondary/80 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-run
        </button>
      </div>

      {dryRun.capabilities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">Capabilities</p>
          <div className="space-y-1">
            {dryRun.capabilities.map((cap: string, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm text-emerald-400/80">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span className="text-foreground/70">{cap}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {dryRun.issues.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">Issues</p>
            <div className="space-y-2">
              {dryRun.issues.map((issue: DryRunIssue) => (
                <HealthIssueCard key={issue.id} issue={issue} personaId={result.personaId}
                  onApplyFix={handleApplyFix} onResolved={markIssueResolved} />
              ))}
            </div>
          </div>
        )}
      </AnimatePresence>

      {dryRun.issues.length === 0 && dryRun.capabilities.length > 0 && (
        <p className="text-sm text-emerald-400/70">No issues found. Your agent configuration looks good.</p>
      )}
    </div>
  );
}
