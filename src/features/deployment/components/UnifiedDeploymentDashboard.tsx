import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cloud, GitBranch, RefreshCw, Activity,
  CheckCircle2, PauseCircle,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { DeployTarget, DeployStatus, SortKey, SortDir, UnifiedDeployment } from './deploymentTypes';
import { compareValues } from './deploymentTypes';
import { SummaryCard } from './DeploymentSubComponents';
import { DeploymentTable } from './DeploymentTable';
import { DeploymentFilters } from './DeploymentFilters';

export function UnifiedDeploymentDashboard() {
  const personas = useAgentStore((s) => s.personas);
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
  const gitlabFetchAgents = useSystemStore((s) => s.gitlabFetchAgents);
  const gitlabUndeployAgent = useSystemStore((s) => s.gitlabUndeployAgent);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState<DeployTarget | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<DeployStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    if (cloudConfig?.is_connected) cloudFetchDeployments().catch(() => {});
    if (gitlabConfig?.isConnected && gitlabSelectedProjectId) {
      gitlabFetchAgents(gitlabSelectedProjectId).catch(() => {});
    }
  }, [cloudConfig?.is_connected, gitlabConfig?.isConnected, gitlabSelectedProjectId, cloudFetchDeployments, gitlabFetchAgents]);

  const personaName = useCallback(
    (id: string) => personas.find((p) => p.id === id)?.name ?? id.slice(0, 8),
    [personas],
  );

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

  const totalCloud = unified.filter((r) => r.target === 'cloud').length;
  const totalGitlab = unified.filter((r) => r.target === 'gitlab').length;
  const activeCount = unified.filter((r) => r.status === 'active').length;
  const pausedCount = unified.filter((r) => r.status === 'paused').length;
  const totalInvocations = unified.reduce((sum, r) => sum + r.invocations, 0);
  const cloudConnected = !!cloudConfig?.is_connected;
  const gitlabConnected = !!gitlabConfig?.isConnected;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground/90">Deployments</h1>
            <p className="text-sm text-muted-foreground/60 mt-0.5">All deployments across Cloud and GitLab</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-5 3xl:grid-cols-10 gap-3">
          <SummaryCard icon={Activity} label="Total" value={unified.length} />
          <SummaryCard icon={CheckCircle2} label="Active" value={activeCount} color="text-emerald-400" />
          <SummaryCard icon={PauseCircle} label="Paused" value={pausedCount} color="text-amber-400" />
          <SummaryCard icon={Cloud} label="Cloud" value={totalCloud} color="text-blue-400" connected={cloudConnected} />
          <SummaryCard icon={GitBranch} label="GitLab" value={totalGitlab} color="text-orange-400" connected={gitlabConnected} />
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
            <p className="text-sm font-medium text-foreground/80">No deployment targets connected</p>
            <p className="text-sm text-muted-foreground/60 mt-1 max-w-xs">
              Connect to Cloud Execution or GitLab in the respective tabs to see deployments here.
            </p>
          </div>
        ) : displayRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-secondary/50 border border-primary/15 flex items-center justify-center mb-4">
              <Activity className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground/80">
              {search || targetFilter !== 'all' || statusFilter !== 'all' ? 'No deployments match filters' : 'No deployments yet'}
            </p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {search || targetFilter !== 'all' || statusFilter !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'Deploy personas from the Cloud or GitLab tabs.'}
            </p>
          </div>
        ) : (
          <DeploymentTable
            displayRows={displayRows} busyId={busyId}
            sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort}
            handleAction={handleAction}
            cloudPauseDeploy={cloudPauseDeploy} cloudResumeDeploy={cloudResumeDeploy}
            cloudRemoveDeploy={cloudRemoveDeploy} gitlabUndeployAgent={gitlabUndeployAgent}
          />
        )}
      </div>

      {/* Footer stats */}
      {displayRows.length > 0 && (
        <div className="px-6 py-2.5 border-t border-primary/10 flex items-center justify-between text-xs text-muted-foreground/60 flex-shrink-0">
          <span>Showing {displayRows.length} of {unified.length} deployment{unified.length !== 1 ? 's' : ''}</span>
          <span>Total invocations: <span className="text-foreground/80 font-medium">{totalInvocations.toLocaleString()}</span></span>
        </div>
      )}
    </div>
  );
}

export default UnifiedDeploymentDashboard;
