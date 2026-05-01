import { useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Activity,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { STATUS_CONFIG } from './statusConfig';
import { HealthWatchToggle } from './HealthWatchToggle';
import { Button } from '@/features/shared/components/buttons';
import { useAgentStore } from "@/stores/agentStore";
import { useTier } from '@/hooks/utility/interaction/useTier';
import { FEASIBILITY_COLORS } from '@/lib/utils/designTokens';
import { isTimestampStale } from '@/stores/slices/agents/healthCheckSlice';
import type { DryRunIssue, DryRunResult } from './types';
import type { UseHealthCheckReturn } from './useHealthCheck';
import { useTranslation } from '@/i18n/useTranslation';
import { formatTimestamp } from '@/lib/utils/formatters';

import { ScoreBadge, ScoreRing } from './HealthScoreDisplay';
import { HealthIssueCard } from './HealthIssueCard';
import { useApplyHealthFix } from './useApplyHealthFix';

interface HealthCheckPanelProps {
  healthCheck: UseHealthCheckReturn;
}

export function HealthCheckPanel({ healthCheck }: HealthCheckPanelProps) {
  const { t, tx } = useTranslation();
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
          <svg width="160" height="100" viewBox="0 0 160 100" fill="none" className="mx-auto mb-4" aria-hidden="true" role="presentation">
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
          <h3 className="typo-body font-medium text-foreground mb-1">{t.agents.health_check.title}</h3>
          <p className="typo-body text-foreground mb-4 max-w-sm mx-auto">
            {t.agents.health_check.idle_description}
          </p>
          <Button
            type="button" onClick={handleRun} disabled={!selectedPersona}
            disabledReason={t.agents.health_check.select_agent}
            aria-describedby={!selectedPersona ? 'health-check-run-reason' : undefined}
            variant="primary"
            size="md"
            icon={<Activity className="w-4 h-4" aria-hidden="true" />}
          >
            {t.agents.health_check.run_check}
          </Button>
          {!selectedPersona && (
            <span id="health-check-run-reason" className="sr-only">
              {t.agents.health_check.select_agent}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div className="text-center py-8">
        <svg width="160" height="100" viewBox="0 0 160 100" fill="none" className="mx-auto mb-3" aria-hidden="true" role="presentation">
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
        <p className="typo-body font-medium text-foreground">{t.agents.health_check.scanning}</p>
        <p className="typo-caption text-foreground mt-1">{t.agents.health_check.scanning_detail}</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 rounded-modal bg-red-500/5 border border-red-500/20">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="typo-body font-medium text-red-400">{t.agents.health_check.check_failed}</p>
              <p className="typo-body text-foreground mt-0.5">{error}</p>
            </div>
          </div>
        </div>
        <Button
          type="button" onClick={() => { reset(); handleRun(); }}
          variant="primary"
          size="sm"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          {t.common.retry}
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
      {isStale && (
        <div
          role="alert"
          className="animate-fade-slide-in flex items-center gap-2 px-3 py-2 rounded-input bg-status-warning/8 border-l-2 border-status-warning"
        >
          <Clock className="w-4 h-4 text-status-warning shrink-0" aria-hidden="true" />
          <span className="typo-caption font-semibold text-status-warning flex-1">
            {t.agents.health_check.stale_banner_label}
          </span>
          <Button
            type="button"
            onClick={handleRun}
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            {t.agents.health_check.run_now}
          </Button>
        </div>
      )}
      <div className="flex items-center gap-4">
        <ScoreRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ScoreBadge score={score} />
            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-card typo-caption font-medium ${statusTokens.bg} ${statusTokens.text} border ${statusTokens.border}`}>
              {(() => {
                const cfg = STATUS_CONFIG[dryRun.status];
                const StatusIcon = cfg.icon;
                return (
                  <>
                    <StatusIcon className="w-3 h-3" />
                    {t.agents.health_check[cfg.labelKey]}
                  </>
                );
              })()}
            </div>
          </div>
          <p className="typo-body text-foreground">
            {remainingIssues > 0 ? tx(remainingIssues === 1 ? t.agents.health_check.issues_found_one : t.agents.health_check.issues_found_other, { count: remainingIssues }) : t.agents.health_check.no_issues}
            {' \u00b7 '}
            {tx(t.agents.health_check.checked_at, { time: formatTimestamp(result.checkedAt) })}
          </p>
        </div>
        <Button type="button" onClick={handleRun}
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          {t.agents.health_check.rerun}
        </Button>
      </div>

      {!isSimple && dryRun.capabilities.length > 0 && (
        <div className="space-y-1.5">
          <p className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.health_check.capabilities}</p>
          <div className="space-y-1">
            {dryRun.capabilities.map((cap: string, i: number) => (
              <div key={i} className="flex items-center gap-2 typo-body text-emerald-400/80">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span className="text-foreground">{cap}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dryRun.issues.length > 0 && (
          <div className="space-y-1.5">
            <p className="typo-body font-medium text-foreground uppercase tracking-wider">{t.agents.ops_health.issues}</p>
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
          <svg width="48" height="56" viewBox="0 0 48 56" fill="none" className="mx-auto mb-2" aria-hidden="true" role="presentation">
            <path d="M24 2L4 12v16c0 14 8.5 22 20 26 11.5-4 20-12 20-26V12L24 2z" fill="#10b981" fillOpacity="0.1" stroke="#10b981" strokeWidth="1.5" strokeOpacity="0.4" strokeLinejoin="round" />
            <path d="M16 28l6 6 10-12" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="typo-body font-medium text-emerald-400/80">{t.agents.health_check.all_healthy}</p>
          <p className="typo-caption text-foreground mt-0.5">{t.agents.health_check.all_healthy_detail}</p>
        </div>
      )}
    </div>
  );
}

