import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cloud, GitBranch, RefreshCw, Activity,
  CheckCircle2, PauseCircle,
} from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { usePersonaNameMap } from "@/hooks/usePersonaNameMap";
import { toastCatch } from "@/lib/silentCatch";
import type { DeployTarget, DeployStatus, SortKey, SortDir, UnifiedDeployment } from './deploymentTypes';
import { compareValues } from './deploymentTypes';
import { SummaryCard } from './DeploymentSubComponents';
import { DeploymentTable } from './DeploymentTable';
import { DeploymentFilters } from './DeploymentFilters';
import { BulkActionsToolbar } from './BulkActionsToolbar';
import { useDeploymentHealth } from '../hooks/useDeploymentHealth';
import { useDeploymentTest } from '../hooks/useDeploymentTest';
import { useTranslation } from '@/i18n/useTranslation';

export function UnifiedDeploymentDashboard() {
  const personaName = usePersonaNameMap();
  const cloudDeployments = useSystemStore((s) => s.cloudDeployments);
  const cloudBaseUrl = useSystemStore((s) => s.cloudBaseUrl);
  const cloudConfig = useSystemStore((s) => s.cloudConfig);
  const gitlabConfig = useSystemStore((s) => s.gitlabConfig);
  const gitlabAgents = useSystemStore((s) => s.gitlabAgents);
  const gitlabSelectedProjectId = useSystemStore((s) => s.gitlabSelectedProjectId);

  const cloudFetchDeployments = useSystemStore((s) => s.cloudFetchDeployments);
  const cloudPauseDeploy = useSystemStore((s) => s.cloudPauseDeploy);
  const cloudResumeDeploy = useSystemStore((s) => s.cloudResumeDeploy);
  const cloudRemoveDeploy = useSystemStore((s) => s.cloudRemoveDeploy);
  const cloudBulkPause = useSystemStore((s) => s.cloudBulkPause);
  const cloudBulkResume = useSystemStore((s) => s.cloudBulkResume);
  const cloudBulkRemove = useSystemStore((s) => s.cloudBulkRemove);
  const gitlabFetchAgents = useSystemStore((s) => s.gitlabFetchAgents);
  const gitlabUndeployAgent = useSystemStore((s) => s.gitlabUndeployAgent);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState<DeployTarget | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<DeployStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { t, tx } = useTranslation();
  const dt = t.deployment.dashboard;

  useEffect(() => {
    if (cloudConfig?.is_connected) cloudFetchDeployments().catch(toastCatch("DeploymentDashboard:fetchCloudDeployments", "Failed to fetch cloud deployments"));
    if (gitlabConfig?.isConnected && gitlabSelectedProjectId) {
      gitlabFetchAgents(gitlabSelectedProjectId).catch(toastCatch("DeploymentDashboard:fetchGitlabAgents", "Failed to fetch GitLab agents"));
    }
  }, [cloudConfig?.is_connected, gitlabConfig?.isConnected, gitlabSelectedProjectId, cloudFetchDeployments, gitlabFetchAgents]);

  const unified = useMemo<UnifiedDeployment[]>(() => {
    const rows: UnifiedDeployment[] = [];
    for (const d of cloudDeployments) {
      rows.push({
        id: `cloud-${d.id}`, target: 'cloud',
        personaName: d.label || personaName(d.persona_id), personaId: d.persona_id,
        name: d.label || personaName(d.persona_id),
        status: (d.status === 'active' || d.status === 'paused' || d.status === 'failed' ? d.status : 'unknown') as DeployStatus,
        invocations: d.invocation_count, lastActivity: d.last_invoked_at,
        createdAt: d.created_at,
        webUrl: cloudBaseUrl ? `${cloudBaseUrl}/api/deployed/${d.slug}` : null,
        _cloud: d,
      });
    }
    for (const a of gitlabAgents) {
      rows.push({
        id: `gitlab-${a.id}`, target: 'gitlab', personaName: a.name, personaId: null,
        name: a.name, status: 'active', invocations: 0,
        lastActivity: a.createdAt, createdAt: a.createdAt, webUrl: a.webUrl,
        _gitlab: a, _gitlabProjectId: gitlabSelectedProjectId ?? undefined,
      });
    }
    return rows;
  }, [cloudDeployments, gitlabAgents, cloudBaseUrl, personaName, gitlabSelectedProjectId]);

  const { healthMap } = useDeploymentHealth(unified);
  const { tests, runTest, dismissResult } = useDeploymentTest();

  const displayRows = useMemo(() => {
    let rows = unified;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.target.includes(q));
    }
    if (targetFilter !== 'all') rows = rows.filter((r) => r.target === targetFilter);
    if (statusFilter !== 'all') rows = rows.filter((r) => r.status === statusFilter);
    return [...rows].sort((a, b) => compareValues(a, b, sortKey, sortDir));
  }, [unified, search, targetFilter, statusFilter, sortKey, sortDir]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const promises: Promise<void>[] = [];
      if (cloudConfig?.is_connected) promises.push(cloudFetchDeployments());
      if (gitlabConfig?.isConnected && gitlabSelectedProjectId) {
        promises.push(gitlabFetchAgents(gitlabSelectedProjectId));
      }
      await Promise.allSettled(promises);
    } finally { setIsRefreshing(false); }
  };

  const handleAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); } finally { setBusyId(null); }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = displayRows.every((r) => prev.has(r.id));
      if (allSelected) return new Set();
      return new Set(displayRows.map((r) => r.id));
    });
  }, [displayRows]);

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedRows = useMemo(
    () => displayRows.filter((r) => selectedIds.has(r.id)),
    [displayRows, selectedIds],
  );

  const { totalCloud, totalGitlab, activeCount, pausedCount, totalInvocations } = useMemo(() => {
    let cloud = 0, gitlab = 0, active = 0, paused = 0, invocations = 0;
    for (const r of unified) {
      if (r.target === 'cloud') cloud++;
      else if (r.target === 'gitlab') gitlab++;
      if (r.status === 'active') active++;
      else if (r.status === 'paused') paused++;
      invocations += r.invocations;
    }
    return { totalCloud: cloud, totalGitlab: gitlab, activeCount: active, pausedCount: paused, totalInvocations: invocations };
  }, [unified]);
  const cloudConnected = !!cloudConfig?.is_connected;
  const gitlabConnected = !!gitlabConfig?.isConnected;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground/90">{dt.title}</h1>
            <p className="text-sm text-muted-foreground/60 mt-0.5">{dt.subtitle}</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {dt.refresh}
          </button>
        </div>
        <div className="grid grid-cols-5 3xl:grid-cols-10 gap-3">
          <SummaryCard icon={Activity} label={dt.total} value={unified.length} />
          <SummaryCard icon={CheckCircle2} label={dt.active} value={activeCount} color="text-emerald-400" />
          <SummaryCard icon={PauseCircle} label={dt.paused} value={pausedCount} color="text-amber-400" />
          <SummaryCard icon={Cloud} label={dt.cloud} value={totalCloud} color="text-blue-400" connected={cloudConnected} />
          <SummaryCard icon={GitBranch} label={dt.gitlab} value={totalGitlab} color="text-orange-400" connected={gitlabConnected} />
        </div>
        <DeploymentFilters
          search={search} onSearchChange={setSearch}
          targetFilter={targetFilter} onTargetFilterChange={setTargetFilter}
          statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {!cloudConnected && !gitlabConnected ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Cloud className="w-7 h-7 text-primary/60" />
            </div>
            <p className="text-sm font-medium text-foreground/80">{dt.no_targets_title}</p>
            <p className="text-sm text-muted-foreground/60 mt-1 max-w-xs">
              {dt.no_targets_hint}
            </p>
          </div>
        ) : displayRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-secondary/50 border border-primary/15 flex items-center justify-center mb-4">
              <Activity className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground/80">
              {search || targetFilter !== 'all' || statusFilter !== 'all' ? dt.no_match_filters : dt.no_deployments}
            </p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {search || targetFilter !== 'all' || statusFilter !== 'all'
                ? dt.adjust_filters
                : dt.deploy_hint}
            </p>
          </div>
        ) : (
          <DeploymentTable
            displayRows={displayRows} busyId={busyId}
            sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort}
            handleAction={handleAction}
            cloudPauseDeploy={cloudPauseDeploy} cloudResumeDeploy={cloudResumeDeploy}
            cloudRemoveDeploy={cloudRemoveDeploy} gitlabUndeployAgent={gitlabUndeployAgent}
            healthMap={healthMap}
            testStates={tests} onTest={runTest} onDismissTest={dismissResult}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
          />
        )}
      </div>

      {/* Bulk actions toolbar */}
      {selectedRows.length >= 2 && (
        <BulkActionsToolbar
          selectedRows={selectedRows}
          onClearSelection={handleClearSelection}
          cloudBulkPause={cloudBulkPause}
          cloudBulkResume={cloudBulkResume}
          cloudBulkRemove={cloudBulkRemove}
        />
      )}

      {/* Footer stats */}
      {displayRows.length > 0 && (
        <div className="px-6 py-2.5 border-t border-primary/10 flex items-center justify-between text-xs text-muted-foreground/60 flex-shrink-0">
          <span>{tx(dt.showing_of, { showing: displayRows.length, total: unified.length, plural: unified.length !== 1 ? 's' : '' })}</span>
          <span>{dt.total_invocations} <span className="text-foreground/80 font-medium">{totalInvocations.toLocaleString()}</span></span>
        </div>
      )}
    </div>
  );
}

export default UnifiedDeploymentDashboard;
