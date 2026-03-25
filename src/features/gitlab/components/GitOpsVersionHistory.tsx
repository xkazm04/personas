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
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { GitLabPersonaVersion } from '@/api/system/gitlab';

interface GitOpsVersionHistoryProps {
  projectId: number | null;
}

export function GitOpsVersionHistory({ projectId }: GitOpsVersionHistoryProps) {
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
    } catch {
      // Error handled by store
    }
  };

  const handleSetupBranches = async () => {
    if (!projectId || !selectedPersonaName) return;
    try {
      await setupBranches(projectId, selectedPersonaName);
    } catch {
      // Error handled by store
    }
  };

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground/70">Select a project in the Deploy tab to view version history.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Persona selector */}
      <div>
        <label htmlFor="gitops-persona" className="block text-sm font-medium text-foreground/80 mb-1.5">
          Persona
        </label>
        <select
          id="gitops-persona"
          value={selectedPersonaName}
          onChange={(e) => {
            setSelectedPersonaName(e.target.value);
            setConfirmRollback(null);
          }}
          className="w-full rounded-xl border border-primary/15 bg-secondary/30 px-3 py-2 text-sm text-foreground/90 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
        >
          <option value="">Select a persona...</option>
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
          <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
            <button
              onClick={() => setShowBranches(!showBranches)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground/80 hover:bg-secondary/20 transition-colors"
            >
              {showBranches ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground/60" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              )}
              <GitBranch className="w-4 h-4 text-amber-400" />
              Environment Branches
              <span className="ml-auto text-xs text-muted-foreground/50">
                {branches.length} branch{branches.length !== 1 ? 'es' : ''}
              </span>
            </button>

            {showBranches && (
              <div className="px-3 pb-3 space-y-2">
                {branches.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground/60 mb-2">
                      No environment branches yet
                    </p>
                    <button
                      onClick={handleSetupBranches}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/15 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Create dev / staging / production
                    </button>
                  </div>
                ) : (
                  branches.map((branch) => (
                    <div
                      key={branch.name}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/20 border border-primary/5"
                    >
                      <GitBranch className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground/80">
                          {branch.environment}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground/50 font-mono">
                          {branch.commitSha.slice(0, 8)}
                        </span>
                      </div>
                      {branch.isProtected && (
                        <span title="Protected branch">
                          <Shield className="w-3.5 h-3.5 text-emerald-400/60" />
                        </span>
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
              <History className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-medium text-foreground/80">Version History</h3>
            </div>
            <button
              onClick={loadVersions}
              disabled={loading}
              className="flex items-center gap-1.5 px-2 py-1 text-sm rounded-lg text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            >
              {loading ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>

          {/* Loading state */}
          {loading && versions.length === 0 && (
            <div className="text-center py-8">
              <LoadingSpinner />
              <p className="text-sm text-muted-foreground/60 mt-2">Loading version history...</p>
            </div>
          )}

          {/* Empty state */}
          {!loading && versions.length === 0 && (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Tag className="w-6 h-6 text-amber-400/60" />
              </div>
              <p className="text-sm text-muted-foreground/80">No versions deployed yet</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Deploy this persona with versioning enabled to start tracking history
              </p>
            </div>
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
  const timeAgo = version.createdAt ? formatRelativeTime(version.createdAt) : null;

  return (
    <div
      className={`p-3 rounded-xl border transition-colors ${
        version.isCurrent
          ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
          : 'border-primary/10 bg-secondary/20'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Version badge */}
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            version.isCurrent
              ? 'bg-emerald-500/10 border border-emerald-500/20'
              : 'bg-amber-500/10 border border-amber-500/20'
          }`}
        >
          <Tag
            className={`w-4 h-4 ${
              version.isCurrent ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
        </div>

        {/* Version info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90">
              {version.version}
            </span>
            {version.isCurrent && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-xs font-medium text-emerald-400">
                <Check className="w-3 h-3" />
                Current
              </span>
            )}
            {version.environment && (
              <span className="px-1.5 py-0.5 rounded-md border border-violet-500/20 bg-violet-500/10 text-xs font-medium text-violet-400">
                {version.environment}
              </span>
            )}
          </div>

          {version.commitMessage && (
            <p className="text-sm text-muted-foreground/60 mt-0.5 truncate">
              {version.commitMessage}
            </p>
          )}

          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/50">
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
                  Confirm rollback
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
                title={`Rollback to ${version.version}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Rollback
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}
