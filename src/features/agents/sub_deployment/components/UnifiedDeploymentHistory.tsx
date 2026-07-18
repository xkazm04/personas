import { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronRight, Cloud, GitBranch, FileText, RotateCcw } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { targetBadge, type DeployTarget } from './deploymentTypes';

/**
 * Unified deployment audit trail — one collapsible section that lists BOTH
 * Personas Cloud and GitLab deployment/sync history rows (backed by the
 * `list_deployment_history_all` query), newest first. Cloud rows were
 * previously never recorded; now they show up here alongside GitLab with a
 * target badge and a prompt-snapshot indicator.
 */
export function UnifiedDeploymentHistory() {
  const { t } = useTranslation();
  const dt = t.deployment.dashboard;
  const [open, setOpen] = useState(false);

  const history = useSystemStore((s) => s.unifiedDeploymentHistory);
  const loading = useSystemStore((s) => s.unifiedDeploymentHistoryLoading);
  const fetchHistory = useSystemStore((s) => s.fetchUnifiedDeploymentHistory);

  useEffect(() => {
    if (open) {
      fetchHistory(100).catch(
        toastCatch('UnifiedDeploymentHistory:fetch', 'Failed to load deployment history'),
      );
    }
  }, [open, fetchHistory]);

  return (
    <div className="border-t border-primary/10 flex-shrink-0" data-testid="unified-deploy-history">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-6 py-2.5 typo-caption text-foreground hover:text-foreground/90 transition-colors cursor-pointer"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <History className="w-3.5 h-3.5 text-foreground" />
        <span className="font-medium">{dt.history_title}</span>
        {history.length > 0 && (
          <span className="ml-1 text-foreground">
            <Numeric value={history.length} className="typo-caption" />
          </span>
        )}
      </button>

      {open && (
        <div className="max-h-64 overflow-auto px-6 pb-3">
          {loading && history.length === 0 ? (
            <div className="flex items-center gap-2 py-4 typo-caption text-foreground">
              <LoadingSpinner size="xs" />
              {t.common.loading}
            </div>
          ) : history.length === 0 ? (
            <p className="py-4 typo-caption text-foreground">{dt.history_empty}</p>
          ) : (
            <ul className="space-y-1">
              {history.map((r) => {
                const target: DeployTarget = r.target === 'cloud' ? 'cloud' : 'gitlab';
                const tb = targetBadge(target);
                const TargetIcon = target === 'cloud' ? Cloud : GitBranch;
                const isRollback = !!r.rolledBackFrom;
                return (
                  <li
                    key={r.id}
                    data-testid={`history-row-${r.id}`}
                    data-target={r.target}
                    className="flex items-center gap-2.5 py-1.5 typo-caption"
                  >
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card border ${tb.cls}`}
                    >
                      <TargetIcon className="w-3 h-3" />
                      {tb.label}
                    </span>
                    <span className="font-medium text-foreground/90 truncate max-w-[16rem]">
                      {r.personaName}
                    </span>
                    {isRollback && (
                      <Tooltip content={t.gitlab.rollback}>
                        <RotateCcw className="w-3 h-3 text-amber-400" />
                      </Tooltip>
                    )}
                    {r.snapshotPrompt && (
                      <Tooltip content={dt.history_snapshot}>
                        <FileText className="w-3 h-3 text-sky-400" data-testid={`history-snapshot-${r.id}`} />
                      </Tooltip>
                    )}
                    <span className="ml-auto text-foreground tabular-nums">
                      <RelativeTime timestamp={r.createdAt} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default UnifiedDeploymentHistory;
