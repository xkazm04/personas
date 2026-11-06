import { useState, useEffect, useCallback } from 'react';
import {
  History,
  RotateCcw,
  Tag,
  GitBranch,
  Check,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Plus,
  Shield,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { GitLabPersonaVersion } from '@/api/system/gitlab';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';


import Button from '@/features/shared/components/buttons/Button';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
interface GitOpsVersionHistoryProps {
  projectId: number | null;
}

export function GitOpsVersionHistory({ projectId }: GitOpsVersionHistoryProps) {
  const { t, tx } = useTranslation();
  const [selectedPersonaName, setSelectedPersonaName] = useState<string>('');
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);
  const [showBranches, setShowBranches] = useState(false);

  const personas = useAgentStore((s) => s.personas);
  const versions = useSystemStore((s) => s.gitlabPersonaVersions);
  const branches = useSystemStore((s) => s.gitlabPersonaBranches);
  const loading = useSystemStore((s) => s.gitlabVersionsLoading);
  const rollingBack = useSystemStore((s) => s.gitlabRollingBack);
  const fetchVersions = useSystemStore((s) => s.gitlabFetchPersonaVersions);
  const fetchBranches = useSystemStore((s) => s.gitlabFetchPersonaBranches);
  const setupBranches = useSystemStore((s) => s.gitlabSetupPersonaBranches);
  const rollbackPersona = useSystemStore((s) => s.gitlabRollbackPersona);

  const loadVersions = useCallback(() => {
    if (projectId && selectedPersonaName) {
      fetchVersions(projectId, selectedPersonaName);
      fetchBranches(projectId, selectedPersonaName);
    }
  }, [projectId, selectedPersonaName, fetchVersions, fetchBranches]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handleRollback = async (version: GitLabPersonaVersion) => {
    if (!projectId || !selectedPersonaName) return;
    if (confirmRollback !== version.tagName) {
      setConfirmRollback(version.tagName);
      return;
    }
    try {
      await rollbackPersona(projectId, selectedPersonaName, version.tagName);
      setConfirmRollback(null);
    } catch (err) { silentCatch("features/plugins/gitlab/components/GitOpsVersionHistory:catch1")(err); }
  };

  const handleSetupBranches = async () => {
    if (!projectId || !selectedPersonaName) return;
    try {
      await setupBranches(projectId, selectedPersonaName);
    } catch (err) { silentCatch("features/plugins/gitlab/components/GitOpsVersionHistory:catch2")(err); }
  };

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="typo-body text-ink-1">{t.gitlab.select_project_for_versions}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Persona selector */}
      <div>
        <label htmlFor="gitops-persona" className="block typo-body text-ink-1 mb-1.5">
          {t.gitlab.persona_label}
        </label>
        <select
          id="gitops-persona"
          value={selectedPersonaName}
          onChange={(e) => {
            setSelectedPersonaName(e.target.value);
            setConfirmRollback(null);
          }}
          className="w-full rounded-modal border border-hair bg-surface-1 px-3 py-2 typo-body text-ink-2 focus:outline-none focus:ring-1 focus:ring-status-warning/30"
        >
          <option value="">{t.gitlab.select_persona}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.name}>
              {p.icon ? `${p.icon} ` : ''}{p.name}
            </option>
          ))}
        </select>
      </div>

      {selectedPersonaName && (
        <>
          {/* Environment branches section */}
          <div className="rounded-modal border border-hair bg-surface-1 overflow-hidden">
            <Button
              type="button"
              onClick={() => setShowBranches(!showBranches)}
              variant="ghost"
              size="sm"
              block
            >
              {showBranches ? (
                <ChevronDown className="w-4 h-4 text-ink-1" />
              ) : (
                <ChevronRight className="w-4 h-4 text-ink-1" />
              )}
              <GitBranch className="w-4 h-4 text-status-warning" />
              {t.gitlab.environment_branches}
              <span className="ml-auto typo-caption text-ink-2">
                {tx(branches.length === 1 ? t.gitlab.branch_count_one : t.gitlab.branch_count_other, { count: branches.length })}
              </span>
            </Button>

            {showBranches && (
              <div className="px-3 pb-3 space-y-2">
                {branches.length === 0 ? (
                  <EmptyState
                    icon={GitBranch}
                    size="sm"
                    title={t.gitlab.no_environment_branches}
                    action={{ label: t.gitlab.create_branches, icon: Plus, onClick: () => { void handleSetupBranches(); } }}
                  />
                ) : (
                  branches.map((branch) => (
                    <div
                      key={branch.name}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-card bg-surface-1 border border-hair"
                    >
                      <GitBranch className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="typo-body text-ink-1">
                          {branch.environment}
                        </span>
                        <span className="ml-2 typo-code text-ink-1">
                          {branch.commitSha.slice(0, 8)}
                        </span>
                      </div>
                      {branch.isProtected && (
                        <Tooltip content={t.gitlab.protected_branch}>
                          <span >
                            <Shield className="w-3.5 h-3.5 text-status-success" />
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Version history header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-status-warning" />
              <h3 className="typo-body text-ink-1">{t.gitlab.version_history}</h3>
            </div>
            <Button
              type="button"
              onClick={loadVersions}
              disabled={loading}
              variant="ghost"
              size="sm"
            >
              {loading ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {t.common.refresh}
            </Button>
          </div>

          {/* Loading state */}
          {loading && versions.length === 0 && (
            <div className="text-center py-8">
              <LoadingSpinner />
              <p className="typo-body text-ink-1 mt-2">{t.gitlab.loading_version_history}</p>
            </div>
          )}

          {/* Empty state */}
          {!loading && versions.length === 0 && (
            <EmptyState
              art="archive"
              size="sm"
              title={t.gitlab.no_versions}
              description={t.gitlab.deploy_with_versioning}
            />
          )}

          {/* Version list */}
          {versions.length > 0 && (
            <div className="space-y-2">
              {versions.map((version) => (
                <VersionRow
                  key={version.tagName}
                  version={version}
                  isConfirming={confirmRollback === version.tagName}
                  rollingBack={rollingBack}
                  onRollback={() => handleRollback(version)}
                  onCancelRollback={() => setConfirmRollback(null)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VersionRow
// ---------------------------------------------------------------------------

interface VersionRowProps {
  version: GitLabPersonaVersion;
  isConfirming: boolean;
  rollingBack: boolean;
  onRollback: () => void;
  onCancelRollback: () => void;
}

function VersionRow({ version, isConfirming, rollingBack, onRollback, onCancelRollback }: VersionRowProps) {
  const { t, tx } = useTranslation();
  const timeAgo = version.createdAt ? formatRelativeTime(version.createdAt, '-', { dateFallbackDays: 30 }) : null;

  return (
    <div
      className={`p-3 rounded-modal border transition-colors ${
        version.isCurrent
          ? 'border-status-success/20 bg-status-success/10/[0.03]'
          : 'border-hair bg-surface-1'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Version badge */}
        <div
          className={`w-9 h-9 rounded-card flex items-center justify-center flex-shrink-0 ${
            version.isCurrent
              ? 'bg-status-success/10 border border-status-success/20'
              : 'bg-status-warning/10 border border-status-warning/20'
          }`}
        >
          <Tag
            className={`w-4 h-4 ${
              version.isCurrent ? 'text-status-success' : 'text-status-warning'
            }`}
          />
        </div>

        {/* Version info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-body text-ink-2">
              {version.version}
            </span>
            {version.isCurrent && (
              <StatusBadge variant="success" className="typo-caption" icon={<Check className="w-3 h-3" />}>
                {t.gitlab.current}
              </StatusBadge>
            )}
            {version.environment && (
              <StatusBadge accent="violet" className="typo-caption">
                {version.environment}
              </StatusBadge>
            )}
          </div>

          {version.commitMessage && (
            <p className="typo-body text-ink-1 mt-0.5 truncate">
              {version.commitMessage}
            </p>
          )}

          <div className="flex items-center gap-3 mt-1.5 typo-caption text-ink-2">
            <span className="font-mono">{version.commitSha.slice(0, 8)}</span>
            {version.createdBy && <span>{version.createdBy}</span>}
            {timeAgo && <span>{timeAgo}</span>}
          </div>
        </div>

        {/* Rollback action */}
        {!version.isCurrent && (
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
                  {t.gitlab.confirm_rollback_version}
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
                tooltip={tx(t.gitlab.rollback_to_version, { version: version.version })}
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
  );
}

