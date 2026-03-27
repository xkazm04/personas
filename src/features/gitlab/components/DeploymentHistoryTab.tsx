import { useState, useEffect, useCallback } from 'react';
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
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { GitLabDeploymentRecord } from '@/api/system/gitlab';

interface DeploymentHistoryTabProps {
  projectId: number | null;
}

export function DeploymentHistoryTab({ projectId }: DeploymentHistoryTabProps) {
  const [filterPersonaId, setFilterPersonaId] = useState<string>('');
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);

  const personas = useAgentStore((s) => s.personas);
  const history = useSystemStore((s) => s.gitlabDeploymentHistory);
  const loading = useSystemStore((s) => s.gitlabDeploymentHistoryLoading);
  const rollingBack = useSystemStore((s) => s.gitlabRollingBackFromHistory);
  const fetchHistory = useSystemStore((s) => s.gitlabFetchDeploymentHistory);
  const rollbackFromHistory = useSystemStore((s) => s.gitlabRollbackFromHistory);

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
    } catch {
      // Error handled by store
    }
  };

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground/70">
          Select a project in the Deploy tab to view deployment history.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter by persona */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label htmlFor="history-persona-filter" className="block text-sm font-medium text-foreground/80 mb-1.5">
            Filter by Persona
          </label>
          <select
            id="history-persona-filter"
            value={filterPersonaId}
            onChange={(e) => {
              setFilterPersonaId(e.target.value);
              setConfirmRollback(null);
            }}
            className="w-full rounded-xl border border-primary/15 bg-secondary/30 px-3 py-2 text-sm text-foreground/90 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
          >
            <option value="">All personas</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon ? `${p.icon} ` : ''}{p.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="mt-6 flex items-center gap-1.5 px-2.5 py-2 text-sm rounded-lg text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          {loading ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-medium text-foreground/80">Deployment Timeline</h3>
        <span className="ml-auto text-xs text-muted-foreground/50">
          {history.length} deployment{history.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Loading */}
      {loading && history.length === 0 && (
        <div className="text-center py-8">
          <LoadingSpinner />
          <p className="text-sm text-muted-foreground/60 mt-2">Loading deployment history...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && history.length === 0 && (
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Rocket className="w-6 h-6 text-amber-400/60" />
          </div>
          <p className="text-sm text-muted-foreground/80">No deployments recorded yet</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            Deploy a persona to start building deployment history
          </p>
        </div>
      )}

      {/* Timeline */}
      {history.length > 0 && (
        <div className="relative space-y-0">
          {/* Vertical timeline line */}
          <div className="absolute left-[18px] top-4 bottom-4 w-px bg-primary/10" />

          {history.map((record, idx) => (
            <DeploymentRow
              key={record.id}
              record={record}
              isLatest={idx === 0}
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
  const timeAgo = formatRelativeTime(record.createdAt, '-', { dateFallbackDays: 30 });
  const isRollback = !!record.rolledBackFrom;

  return (
    <div className="relative pl-10 py-2">
      {/* Timeline dot */}
      <div
        className={`absolute left-2.5 top-4 w-3 h-3 rounded-full border-2 ${
          isLatest
            ? 'bg-emerald-400 border-emerald-400/40'
            : isRollback
              ? 'bg-amber-400 border-amber-400/40'
              : 'bg-primary/30 border-primary/20'
        }`}
      />

      <div
        className={`p-3 rounded-xl border transition-colors ${
          isLatest
            ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
            : 'border-primary/10 bg-secondary/20'
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isRollback
                ? 'bg-amber-500/10 border border-amber-500/20'
                : 'bg-orange-500/10 border border-orange-500/20'
            }`}
          >
            {isRollback ? (
              <RotateCcw className="w-4 h-4 text-amber-400" />
            ) : (
              <Rocket className="w-4 h-4 text-orange-400" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground/90">
                {record.personaName}
              </span>
              {isLatest && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-xs font-medium text-emerald-400">
                  <Check className="w-3 h-3" />
                  Current
                </span>
              )}
              {isRollback && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/20 bg-amber-500/10 text-xs font-medium text-amber-400">
                  <RotateCcw className="w-3 h-3" />
                  Rollback
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded-md border border-primary/10 bg-secondary/30 text-xs text-muted-foreground/60">
                {record.method === 'api' ? 'Duo Agent API' : 'AGENTS.md'}
              </span>
            </div>

            {record.credentialsProvisioned > 0 && (
              <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1">
                <KeyRound className="w-3 h-3 text-orange-400/70" />
                {record.credentialsProvisioned} credential{record.credentialsProvisioned !== 1 ? 's' : ''} provisioned
              </p>
            )}

            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/50">
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
                  <button
                    onClick={onRollback}
                    disabled={rollingBack}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                  >
                    {rollingBack ? (
                      <LoadingSpinner size="xs" />
                    ) : (
                      <AlertTriangle className="w-3 h-3" />
                    )}
                    Confirm
                  </button>
                  <button
                    onClick={onCancelRollback}
                    disabled={rollingBack}
                    className="px-2 py-1.5 text-xs rounded-lg text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={onRollback}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 text-muted-foreground/60 hover:text-amber-400 transition-colors"
                  title="Rollback to this deployment"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Rollback
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

