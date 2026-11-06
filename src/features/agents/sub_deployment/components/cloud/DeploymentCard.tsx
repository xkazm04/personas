import { useTranslation } from '@/i18n/useTranslation';
import { useState } from 'react';
import { useKeyedCopyFlag } from '@/hooks/utility/interaction/useKeyedCopyFlag';
import { Pause, Play, Trash2, Copy, ExternalLink, Check, DollarSign, FlaskConical, X } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { CloudDeployment } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { statusColor, statusIcon, timeAgo, budgetUtilization, budgetColor, formatCost } from './cloudDeploymentHelpers';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import type { TestResult } from '../../hooks/useDeploymentTest';
import { ApiPlayground } from './ApiPlayground';
import { tokenLabel } from '@/i18n/tokenMaps';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
  const { t } = useTranslation();
  const dt = t.deployment.deploy_card;
  const { copiedKey: copiedId, copy } = useKeyedCopyFlag<string>();
  const [busyId, setBusyId] = useState<string | null>(null);

  const endpointUrl = baseUrl ? `${baseUrl}/api/deployed/${d.slug}` : `/api/deployed/${d.slug}`;
  const isBusy = busyId === d.id;
  const budgetPct = budgetUtilization(d);

  const handleAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); } finally { setBusyId(null); }
  };

  const copyEndpoint = (slug: string) => {
    const url = baseUrl ? `${baseUrl}/api/deployed/${slug}` : `/api/deployed/${slug}`;
    copy(slug, url);
  };

  return (
    <div className={`p-3 ${DEPLOYMENT_TOKENS.cardRadius} bg-surface-1 border border-hair space-y-2`}>
      {/* Header row: name + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="typo-body text-ink-1">
            {d.label || personaName}
          </span>
          {(() => {
            const StatusIcon = statusIcon(d.status);
            return (
              <span className={`inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-card border ${statusColor(d.status)}`}>
                <StatusIcon className="w-3 h-3" aria-hidden="true" />
                {tokenLabel(t, 'deployment', d.status)}
              </span>
            );
          })()}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Busy state on an action control is a REAL spinner (AsyncButton),
              the same shape DeploymentTable uses. The previous
              `busy ? <LoadingSpinner/> : <Icon/>` swap made the icon vanish
              into nothing, because LoadingSpinner renders null. */}
          {d.status === 'active' && onTest && (
            <AsyncButton
              variant="ghost"
              size="icon-sm"
              title={dt.test_deployment}
              onClick={() => onTest(d.id, d.personaId)}
              disabled={isBusy}
              isLoading={testRunning ?? false}
              icon={<FlaskConical className="w-3.5 h-3.5" />}
              className="hover:!text-status-info hover:!bg-status-info/10"
            />
          )}
          {d.status === 'active' && (
            <AsyncButton
              variant="ghost"
              size="icon-sm"
              title={dt.pause_deployment}
              onClick={() => handleAction(d.id, () => onPause(d.id))}
              isLoading={isBusy}
              icon={<Pause className="w-3.5 h-3.5" />}
              className="hover:!text-status-warning hover:!bg-status-warning/10"
            />
          )}
          {d.status === 'paused' && (
            <AsyncButton
              variant="ghost"
              size="icon-sm"
              title={dt.resume_deployment}
              onClick={() => handleAction(d.id, () => onResume(d.id))}
              isLoading={isBusy}
              icon={<Play className="w-3.5 h-3.5" />}
              className="hover:!text-status-success hover:!bg-status-success/10"
            />
          )}
          <Button aria-label={dt.remove_deployment}
            type="button"
            tooltip={dt.remove_deployment}
            onClick={() => handleAction(d.id, () => onRemove(d.id))}
            disabled={isBusy}
            variant="ghost"
            size="icon-sm"
            icon={<Trash2 className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      {/* Endpoint URL */}
      <div className="flex items-center gap-1.5">
        <code className="flex-1 typo-caption text-ink-1 bg-surface-2 px-2 py-1 rounded-card truncate border border-hair">
          {endpointUrl}
        </code>
        <Button aria-label={dt.copy_endpoint}
          type="button"
          tooltip={dt.copy_endpoint}
          onClick={() => copyEndpoint(d.slug)}
          variant="ghost"
          size="icon-sm"
          icon={copiedId === d.slug ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
        />
        {sanitizeExternalUrl(endpointUrl) && (
          <Tooltip content={dt.open_endpoint}><a
            href={sanitizeExternalUrl(endpointUrl)!}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-card text-ink-1 hover:text-ink-1
                       hover:bg-surface-2 transition-colors focus-ring">
            <ExternalLink className="w-3.5 h-3.5" />
          </a></Tooltip>
        )}
      </div>

      {/* Budget gauge */}
      {d.maxMonthlyBudgetUsd != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between typo-caption text-ink-2">
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              {dt.budget_label} {formatCost(d.currentMonthCostUsd)} / {formatCost(d.maxMonthlyBudgetUsd)}
            </span>
            {budgetPct == null
              ? <span>{t.status_tokens.deployment.unknown}</span>
              : <Numeric value={budgetPct} unit="percent" precision={0} />}
          </div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budgetColor(budgetPct ?? 0)}`}
              style={{ width: `${Math.min(100, budgetPct ?? 0)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 typo-caption text-ink-2">
        <span>{dt.label_invocations} <span className="text-ink-1 font-medium">{d.invocationCount}</span></span>
        <span>{dt.label_last_called} <span className="text-ink-1">{timeAgo(d.lastInvokedAt)}</span></span>
        <span>{dt.label_created} <span className="text-ink-1">{timeAgo(d.createdAt)}</span></span>
      </div>

      {/* Inline test result */}
      {testResult && (
        <div
          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-card border typo-caption ${
            testResult.status === 'pass'
              ? 'bg-status-success/10 border-status-success/20 text-status-success'
              : 'bg-status-error/10 border-status-error/20 text-status-error'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-medium shrink-0">
              {testResult.status === 'pass' ? dt.test_pass : dt.test_fail}
            </span>
            {testResult.durationMs != null && (
              <Numeric value={testResult.durationMs} unit="ms" className="text-ink-1" />
            )}
            {testResult.costUsd != null && testResult.costUsd > 0 && (
              <Numeric value={testResult.costUsd} unit="usd" className="text-ink-1" />
            )}
            {testResult.error && (
              <Tooltip content={testResult.error}><span className="truncate text-status-error">
                {testResult.error}
              </span></Tooltip>
            )}
          </div>
          {onDismissTest && (
            <Button
              type="button"
              aria-label={t.common.dismiss}
              onClick={() => onDismissTest(d.id)}
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              icon={<X className="w-3 h-3" />}
            />
          )}
        </div>
      )}

      {/* API Playground - only for active deployments */}
      {d.status === 'active' && (
        <ApiPlayground
          slug={d.slug}
          personaId={d.personaId}
          endpointUrl={endpointUrl}
        />
      )}
    </div>
  );
}
