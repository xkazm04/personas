import { useState } from 'react';
import { Pause, Play, Trash2, Copy, ExternalLink, Check, DollarSign, FlaskConical, X } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CloudDeployment } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { statusColor, timeAgo, budgetUtilization, budgetColor, formatCost } from './cloudDeploymentHelpers';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import type { TestResult } from '../../hooks/useDeploymentTest';
import { ApiPlayground } from './ApiPlayground';

interface DeploymentCardProps {
  deployment: CloudDeployment;
  baseUrl: string | null;
  personaName: string;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  testRunning?: boolean;
  testResult?: TestResult | null;
  onTest?: (deploymentId: string, personaId: string) => void;
  onDismissTest?: (deploymentId: string) => void;
}

export function DeploymentCard({
  deployment: d,
  baseUrl,
  personaName,
  onPause,
  onResume,
  onRemove,
  testRunning,
  testResult,
  onTest,
  onDismissTest,
}: DeploymentCardProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const endpointUrl = baseUrl ? `${baseUrl}/api/deployed/${d.slug}` : `/api/deployed/${d.slug}`;
  const isBusy = busyId === d.id;

  const handleAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); } finally { setBusyId(null); }
  };

  const copyEndpoint = (slug: string) => {
    const url = baseUrl ? `${baseUrl}/api/deployed/${slug}` : `/api/deployed/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedId(slug);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={`p-3 ${DEPLOYMENT_TOKENS.cardRadius} bg-secondary/30 border border-primary/10 space-y-2`}>
      {/* Header row: name + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground/90">
            {d.label || personaName}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-lg border font-medium ${statusColor(d.status)}`}>
            {d.status}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {d.status === 'active' && onTest && (
            <button
              type="button"
              title="Test deployment"
              onClick={() => onTest(d.id, d.persona_id)}
              disabled={isBusy || testRunning}
              className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-blue-400
                         hover:bg-blue-500/10 disabled:opacity-40 transition-colors cursor-pointer"
            >
              {testRunning ? <LoadingSpinner size="sm" /> : <FlaskConical className="w-3.5 h-3.5" />}
            </button>
          )}
          {d.status === 'active' && (
            <button
              type="button"
              title="Pause deployment"
              onClick={() => handleAction(d.id, () => onPause(d.id))}
              disabled={isBusy}
              className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-amber-400
                         hover:bg-amber-500/10 disabled:opacity-40 transition-colors cursor-pointer"
            >
              {isBusy ? <LoadingSpinner size="sm" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          )}
          {d.status === 'paused' && (
            <button
              type="button"
              title="Resume deployment"
              onClick={() => handleAction(d.id, () => onResume(d.id))}
              disabled={isBusy}
              className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-emerald-400
                         hover:bg-emerald-500/10 disabled:opacity-40 transition-colors cursor-pointer"
            >
              {isBusy ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            title="Remove deployment"
            onClick={() => handleAction(d.id, () => onRemove(d.id))}
            disabled={isBusy}
            className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-red-400
                       hover:bg-red-500/10 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Endpoint URL */}
      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-xs text-muted-foreground/80 bg-secondary/40 px-2 py-1 rounded-lg truncate border border-primary/10">
          {endpointUrl}
        </code>
        <button
          type="button"
          title="Copy endpoint URL"
          onClick={() => copyEndpoint(d.slug)}
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground/90
                     hover:bg-secondary/50 transition-colors cursor-pointer"
        >
          {copiedId === d.slug ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {sanitizeExternalUrl(endpointUrl) && (
          <a
            href={sanitizeExternalUrl(endpointUrl)!}
            target="_blank"
            rel="noopener noreferrer"
            title="Open endpoint"
            className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground/90
                       hover:bg-secondary/50 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Budget gauge */}
      {d.max_monthly_budget_usd != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground/70">
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              Budget: {formatCost(d.current_month_cost_usd)} / {formatCost(d.max_monthly_budget_usd)}
            </span>
            <span>{budgetUtilization(d)?.toFixed(0) ?? 0}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budgetColor(budgetUtilization(d) ?? 0)}`}
              style={{ width: `${budgetUtilization(d) ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
        <span>Invocations: <span className="text-foreground/80 font-medium">{d.invocation_count}</span></span>
        <span>Last called: <span className="text-foreground/80">{timeAgo(d.last_invoked_at)}</span></span>
        <span>Created: <span className="text-foreground/80">{timeAgo(d.created_at)}</span></span>
      </div>

      {/* Inline test result */}
      {testResult && (
        <div
          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${
            testResult.status === 'pass'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-medium shrink-0">
              {testResult.status === 'pass' ? 'PASS' : 'FAIL'}
            </span>
            {testResult.durationMs != null && (
              <span className="text-muted-foreground/70">
                {testResult.durationMs < 1000
                  ? `${testResult.durationMs}ms`
                  : `${(testResult.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
            {testResult.costUsd > 0 && (
              <span className="text-muted-foreground/70">
                ${testResult.costUsd.toFixed(4)}
              </span>
            )}
            {testResult.error && (
              <span className="truncate text-red-400/80" title={testResult.error}>
                {testResult.error}
              </span>
            )}
          </div>
          {onDismissTest && (
            <button
              type="button"
              onClick={() => onDismissTest(d.id)}
              className="p-0.5 rounded hover:bg-primary/10 transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* API Playground - only for active deployments */}
      {d.status === 'active' && (
        <ApiPlayground
          slug={d.slug}
          personaId={d.persona_id}
          endpointUrl={endpointUrl}
        />
      )}
    </div>
  );
}
