import { useCallback, useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  RefreshCw,
  Clock,
  Eye,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useAgentStore } from "@/stores/agentStore";
import { managementFetch } from '@/api/system/managementApiAuth';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { FEASIBILITY_COLORS } from '@/lib/utils/designTokens';
import { isTimestampStale } from '@/stores/slices/agents/healthCheckSlice';
import type { DryRunIssue, DryRunResult } from './types';
import type { UseHealthCheckReturn } from './useHealthCheck';

import { ScoreBadge, ScoreRing } from './HealthScoreDisplay';
import { HealthIssueCard } from './HealthIssueCard';
import { useApplyHealthFix } from './useApplyHealthFix';

interface HealthCheckPanelProps {
  healthCheck: UseHealthCheckReturn;
}

export function HealthCheckPanel({ healthCheck }: HealthCheckPanelProps) {
  const { isStarter: isSimple } = useTier();
  const { phase, result, score, error, runHealthCheck, markIssueResolved, reset } = healthCheck;
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const handleApplyFix = useApplyHealthFix();

  const handleRun = useCallback(async () => {
    if (!selectedPersona) return;
    await runHealthCheck(selectedPersona);
  }, [selectedPersona, runHealthCheck]);

  if (phase === 'idle') {
    return (
      <div className="space-y-4">
        <HealthWatchToggle />
        <div className="text-center py-8">
          {/* Stethoscope-circuit illustration */}
          <svg width="160" height="100" viewBox="0 0 160 100" fill="none" className="mx-auto mb-4">
            <defs>
              <linearGradient id="hc-tube-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.3" />
              </linearGradient>
            </defs>
            {/* Circuit traces */}
            <path d="M30 70h20l8-12h24l8 12h20" stroke="url(#hc-tube-grad)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M50 70v-20h60v20" stroke="url(#hc-tube-grad)" strokeWidth="1" strokeLinecap="round" strokeDasharray="4 3" fill="none" />
            {/* Stethoscope tubing */}
            <path d="M80 30c-20 0-35 10-35 25s10 20 10 30" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" fill="none" strokeOpacity="0.6" />
            <path d="M80 30c20 0 35 10 35 25s-10 20-10 30" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" fill="none" strokeOpacity="0.6" />
            {/* Earpieces */}
            <circle cx="55" cy="85" r="4" fill="#8b5cf6" fillOpacity="0.4" stroke="#8b5cf6" strokeWidth="1" strokeOpacity="0.3" />
            <circle cx="105" cy="85" r="4" fill="#8b5cf6" fillOpacity="0.4" stroke="#8b5cf6" strokeWidth="1" strokeOpacity="0.3" />
            {/* Chestpiece/probe */}
            <circle cx="80" cy="24" r="10" fill="#8b5cf6" fillOpacity="0.15" stroke="#8b5cf6" strokeWidth="1.5" strokeOpacity="0.5" />
            <circle cx="80" cy="24" r="4" fill="#8b5cf6" fillOpacity="0.3" />
            {/* Circuit nodes */}
            <circle cx="30" cy="70" r="2" fill="#a78bfa" fillOpacity="0.5" />
            <circle cx="110" cy="70" r="2" fill="#a78bfa" fillOpacity="0.5" />
            <circle cx="66" cy="58" r="1.5" fill="#c4b5fd" fillOpacity="0.4" />
            <circle cx="94" cy="58" r="1.5" fill="#c4b5fd" fillOpacity="0.4" />
          </svg>
          <h3 className="text-sm font-medium text-foreground/80 mb-1">Agent Health Check</h3>
          <p className="text-sm text-muted-foreground/80 mb-4 max-w-sm mx-auto">
            Run a dry-run analysis to detect missing credentials,
            disconnected connectors, and underspecified use cases.
          </p>
          <Button
            type="button" onClick={handleRun} disabled={!selectedPersona}
            disabledReason="Select an agent to run health check"
            variant="primary"
            size="md"
            icon={<Activity className="w-4 h-4" />}
          >
            Run Check
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div className="text-center py-8">
        <svg width="160" height="100" viewBox="0 0 160 100" fill="none" className="mx-auto mb-3">
          <defs>
            <linearGradient id="hc-scan-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          {/* Circuit path for probe to travel along */}
          <path id="hc-scan-path" d="M20 50h30l10-15h40l10 15h30" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" fill="none" strokeOpacity="0.2" />
          {/* Animated probe traveling along circuit */}
          <circle r="5" fill="#8b5cf6" fillOpacity="0.6">
            <animateMotion dur="2s" repeatCount="indefinite" path="M20 50h30l10-15h40l10 15h30" />
          </circle>
          <circle r="10" fill="#8b5cf6" fillOpacity="0.15">
            <animateMotion dur="2s" repeatCount="indefinite" path="M20 50h30l10-15h40l10 15h30" />
          </circle>
          {/* Animated scan line */}
          <path d="M20 50h30l10-15h40l10 15h30" stroke="url(#hc-scan-grad)" strokeWidth="2" strokeLinecap="round" fill="none" strokeDasharray="20 100" strokeOpacity="0.7">
            <animate attributeName="stroke-dashoffset" from="0" to="-120" dur="1.5s" repeatCount="indefinite" />
          </path>
          {/* Static nodes */}
          <circle cx="20" cy="50" r="3" fill="#a78bfa" fillOpacity="0.4" />
          <circle cx="140" cy="50" r="3" fill="#a78bfa" fillOpacity="0.4" />
          <circle cx="80" cy="35" r="2" fill="#c4b5fd" fillOpacity="0.3" />
        </svg>
        <p className="text-sm font-medium text-foreground/70">Scanning agent configuration...</p>
        <p className="text-xs text-muted-foreground/50 mt-1">Checking credentials, connectors, and use cases</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/20">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">Health check failed</p>
              <p className="text-sm text-muted-foreground/80 mt-0.5">{error}</p>
            </div>
          </div>
        </div>
        <Button
          type="button" onClick={() => { reset(); handleRun(); }}
          variant="primary"
          size="sm"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!result || !score) return null;

  const isStale = isTimestampStale(result.checkedAt);
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
            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-medium ${statusTokens.bg} ${statusTokens.text} border ${statusTokens.border}`}>
              {dryRun.status === 'ready' ? <CheckCircle2 className="w-3 h-3" /> : dryRun.status === 'blocked' ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {dryRun.status.charAt(0).toUpperCase() + dryRun.status.slice(1)}
            </div>
          </div>
          <p className="text-sm text-muted-foreground/80">
            {remainingIssues > 0 ? `${remainingIssues} issue${remainingIssues !== 1 ? 's' : ''} found` : 'No issues detected'}
            {' \u00b7 '}Checked {new Date(result.checkedAt).toLocaleTimeString()}
            {isStale && (
              <span className="inline-flex items-center gap-1 ml-1.5 text-amber-400/90">
                <Clock className="w-3 h-3" />
                <span className="text-xs">Stale</span>
              </span>
            )}
          </p>
        </div>
        <Button type="button" onClick={handleRun}
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Re-run
        </Button>
      </div>

      {!isSimple && dryRun.capabilities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground/80 uppercase tracking-wider">Capabilities</p>
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

      {dryRun.issues.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-muted-foreground/80 uppercase tracking-wider">Issues</p>
            <div className="space-y-2">
              {dryRun.issues.map((issue: DryRunIssue) => (
                <HealthIssueCard key={issue.id} issue={issue} personaId={result.personaId}
                  onApplyFix={handleApplyFix} onResolved={markIssueResolved} />
              ))}
            </div>
          </div>
        )}

      {dryRun.issues.length === 0 && dryRun.capabilities.length > 0 && (
        <div className="text-center py-4">
          <svg width="48" height="56" viewBox="0 0 48 56" fill="none" className="mx-auto mb-2">
            <path d="M24 2L4 12v16c0 14 8.5 22 20 26 11.5-4 20-12 20-26V12L24 2z" fill="#10b981" fillOpacity="0.1" stroke="#10b981" strokeWidth="1.5" strokeOpacity="0.4" strokeLinejoin="round" />
            <path d="M16 28l6 6 10-12" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-sm font-medium text-emerald-400/80">All systems healthy</p>
          <p className="text-xs text-muted-foreground/50 mt-0.5">No issues detected in agent configuration</p>
        </div>
      )}
    </div>
  );
}

function HealthWatchToggle() {
  const persona = useAgentStore((s) => s.selectedPersona);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!persona) return;
    managementFetch(`/api/settings/health-watch/${persona.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data?.enabled !== undefined) setEnabled(d.data.enabled); })
      .catch(() => {});
  }, [persona]);

  const toggle = async () => {
    if (!persona) return;
    setLoading(true);
    try {
      await managementFetch(`/api/settings/health-watch/${persona.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled, interval_hours: 6, error_threshold: 30 }),
      });
      setEnabled(!enabled);
    } catch { /* silent */ }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-end">
      <button
        data-testid="health-watch-toggle"
        onClick={toggle}
        disabled={loading || !persona}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
          enabled
            ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
            : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
        }`}
        title={enabled ? "Health monitoring active (every 6h)" : "Enable continuous health monitoring"}
      >
        <Eye className={`w-3 h-3 ${enabled ? 'text-cyan-400' : ''}`} />
        Health Watch
        <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-cyan-400' : 'bg-muted-foreground/30'}`} />
      </button>
    </div>
  );
}
