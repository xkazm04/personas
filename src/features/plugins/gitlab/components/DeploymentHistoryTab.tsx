import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History,
  RotateCcw,
  Rocket,
  KeyRound,
  AlertTriangle,
  RefreshCw,
  Clock,
  Check,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { GitLabDeploymentRecord } from '@/api/system/gitlab';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { currentDeploymentIds } from './deploymentHistory';


import Button from '@/features/shared/components/buttons/Button';

interface DeploymentHistoryTabProps {
  projectId: number | null;
}

export function DeploymentHistoryTab({ projectId }: DeploymentHistoryTabProps) {
  const { t, tx } = useTranslation();
  const [filterPersonaId, setFilterPersonaId] = useState<string>('');
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);

  const personas = useAgentStore((s) => s.personas);
  const history = useSystemStore((s) => s.gitlabDeploymentHistory);
  const loading = useSystemStore((s) => s.gitlabDeploymentHistoryLoading);
  const rollingBack = useSystemStore((s) => s.gitlabRollingBackFromHistory);
  const fetchHistory = useSystemStore((s) => s.gitlabFetchDeploymentHistory);
  const rollbackFromHistory = useSystemStore((s) => s.gitlabRollbackFromHistory);
  // Current = newest record PER PERSONA, not the newest row of a mixed list.
  const currentIds = useMemo(() => currentDeploymentIds(history), [history]);

  const loadHistory = useCallback(() => {
    if (projectId) {
      fetchHistory(projectId, filterPersonaId || undefined);
    }
  }, [projectId, filterPersonaId, fetchHistory]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleRollback = async (record: GitLabDeploymentRecord) => {
    if (!projectId) return;
    if (confirmRollback !== record.id) {
      setConfirmRollback(record.id);
      return;
    }
    try {
      await rollbackFromHistory(projectId, record.id);
      setConfirmRollback(null);
    } catch (err) { silentCatch("features/plugins/gitlab/components/DeploymentHistoryTab:catch1")(err); }
  };

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="typo-body text-ink-1">
          {t.gitlab.select_project_for_history}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter by persona */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label htmlFor="history-persona-filter" className="block typo-body text-ink-1 mb-1.5">
            {t.gitlab.filter_by_persona}
          </label>
          <select
            id="history-persona-filter"
            value={filterPersonaId}
            onChange={(e) => {
              setFilterPersonaId(e.target.value);
              setConfirmRollback(null);
            }}
            className="w-full rounded-modal border border-hair bg-surface-1 px-3 py-2 typo-body text-ink-2 focus:outline-none focus:ring-1 focus:ring-status-warning/30"
          >
            <option value="">{t.gitlab.all_personas}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon ? `${p.icon} ` : ''}{p.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          onClick={loadHistory}
          disabled={loading}
          variant="ghost"
          size="sm"
          className="mt-6"
        >
          {loading ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {t.common.refresh}
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-status-warning" />
        <h3 className="typo-body text-ink-1">{t.gitlab.deployment_timeline}</h3>
        <span className="ml-auto typo-caption text-ink-2">
          {tx(history.length === 1 ? t.gitlab.deployment_count_one : t.gitlab.deployment_count_other, { count: history.length })}
        </span>
      </div>

      {/* Loading */}
      {loading && history.length === 0 && (
        <div className="text-center py-8">
          <LoadingSpinner />
          <p className="typo-body text-ink-1 mt-2">{t.gitlab.loading_deployment_history}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && history.length === 0 && (
        <EmptyState
          icon={Rocket}
          size="sm"
          title={t.gitlab.no_deployments}
          description={t.gitlab.deploy_to_build_history}
        />
      )}

      {/* Timeline */}
      {history.length > 0 && (
        <div className="relative space-y-0">
          {/* Vertical timeline line */}
          <div className="absolute left-[18px] top-4 bottom-4 w-px bg-primary/10" />

          {history.map((record) => (
            <DeploymentRow
              key={record.id}
              record={record}
              isLatest={currentIds.has(record.id)}
              isConfirming={confirmRollback === record.id}
              rollingBack={rollingBack}
              onRollback={() => handleRollback(record)}
              onCancelRollback={() => setConfirmRollback(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeploymentRow
// ---------------------------------------------------------------------------

interface DeploymentRowProps {
  record: GitLabDeploymentRecord;
  isLatest: boolean;
  isConfirming: boolean;
  rollingBack: boolean;
  onRollback: () => void;
  onCancelRollback: () => void;
}

function DeploymentRow({
  record,
  isLatest,
  isConfirming,
  rollingBack,
  onRollback,
  onCancelRollback,
}: DeploymentRowProps) {
  const { t, tx } = useTranslation();
  const timeAgo = formatRelativeTime(record.createdAt, '-', { dateFallbackDays: 30 });
  const isRollback = !!record.rolledBackFrom;

  return (
    <div className="relative pl-10 py-2">
      {/* Timeline dot */}
      <div
        className={`absolute left-2.5 top-4 w-3 h-3 rounded-full border-2 ${
          isLatest
            ? 'bg-status-success/10 border-status-success/40'
            : isRollback
              ? 'bg-status-warning/10 border-status-warning/40'
              : 'bg-primary/30 border-hair'
        }`}
      />

      <div
        className={`p-3 rounded-modal border transition-colors ${
          isLatest
            ? 'border-status-success/20 bg-status-success/10/[0.03]'
            : 'border-hair bg-surface-1'
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={`w-8 h-8 rounded-card flex items-center justify-center flex-shrink-0 ${
              isRollback
                ? 'bg-status-warning/10 border border-status-warning/20'
                : 'bg-status-warning/10 border border-status-warning/20'
            }`}
          >
            {isRollback ? (
              <RotateCcw className="w-4 h-4 text-status-warning" />
            ) : (
              <Rocket className="w-4 h-4 text-status-warning" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="typo-body text-ink-2">
                {record.personaName}
              </span>
              {isLatest && (
                <StatusBadge variant="success" className="typo-caption" icon={<Check className="w-3 h-3" />}>
                  {t.gitlab.current}
                </StatusBadge>
              )}
              {isRollback && (
                <StatusBadge variant="warning" className="typo-caption" icon={<RotateCcw className="w-3 h-3" />}>
                  {t.gitlab.rollback}
                </StatusBadge>
              )}
              <span className="px-1.5 py-0.5 rounded-input border border-hair bg-surface-1 typo-caption text-ink-2">
                {record.method === 'api' ? t.gitlab.duo_agent_api : t.gitlab.agents_md}
              </span>
            </div>

            {record.credentialsProvisioned > 0 && (
              <p className="typo-caption text-ink-2 mt-1 flex items-center gap-1">
                <KeyRound className="w-3 h-3 text-status-warning" />
                {tx(record.credentialsProvisioned === 1 ? t.gitlab.credential_provisioned_count_one : t.gitlab.credential_provisioned_count_other, { count: record.credentialsProvisioned })}
              </p>
            )}

            <div className="flex items-center gap-3 mt-1.5 typo-caption text-ink-2">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgo}
              </span>
              <span className="font-mono">{record.id.slice(0, 8)}</span>
            </div>
          </div>

          {/* Rollback action (only if not the current/latest deployment) */}
          {!isLatest && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isConfirming ? (
                <>
                  <Button
                    type="button"
                    onClick={onRollback}
                    disabled={rollingBack}
                    variant="danger"
                    size="sm"
                  >
                    {rollingBack ? (
                      <LoadingSpinner size="xs" />
                    ) : (
                      <AlertTriangle className="w-3 h-3" />
                    )}
                    {t.common.confirm}
                  </Button>
                  <Button
                    type="button"
                    onClick={onCancelRollback}
                    disabled={rollingBack}
                    variant="ghost"
                    size="sm"
                  >
                    {t.common.cancel}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={onRollback}
                  tooltip={t.gitlab.rollback_to_deployment}
                  variant="ghost"
                  size="sm"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t.gitlab.rollback}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

