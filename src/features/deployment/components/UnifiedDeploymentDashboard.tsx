import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cloud, GitBranch, RefreshCw, Pause, Play, Trash2, ExternalLink,
  Loader2, ArrowUpDown, ChevronDown, Search, Filter, Activity,
  CheckCircle2, AlertCircle, PauseCircle, XCircle,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { CloudDeployment } from '@/api/cloud';
import type { GitLabAgent } from '@/api/gitlab';

// ---------------------------------------------------------------------------
// Unified row type
// ---------------------------------------------------------------------------

type DeployTarget = 'cloud' | 'gitlab';
type DeployStatus = 'active' | 'paused' | 'failed' | 'unknown';

interface UnifiedDeployment {
  id: string;
  target: DeployTarget;
  personaName: string;
  personaId: string | null;
  name: string;
  status: DeployStatus;
  invocations: number;
  lastActivity: string | null;
  createdAt: string | null;
  webUrl: string | null;
  /** Original source data for actions */
  _cloud?: CloudDeployment;
  _gitlab?: GitLabAgent;
  _gitlabProjectId?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusIcon(s: DeployStatus) {
  switch (s) {
    case 'active': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'paused': return <PauseCircle className="w-3.5 h-3.5 text-amber-400" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    default: return <AlertCircle className="w-3.5 h-3.5 text-muted-foreground/50" />;
  }
}

function statusBadge(s: DeployStatus) {
  const colors: Record<DeployStatus, string> = {
    active: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    paused: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
    failed: 'bg-red-500/10 border-red-500/20 text-red-400',
    unknown: 'bg-secondary/40 border-primary/15 text-muted-foreground/80',
  };
  return colors[s];
}

function targetBadge(t: DeployTarget) {
  if (t === 'cloud') return { icon: Cloud, label: 'Cloud', cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400' };
  return { icon: GitBranch, label: 'GitLab', cls: 'bg-orange-500/10 border-orange-500/20 text-orange-400' };
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type SortKey = 'name' | 'target' | 'status' | 'invocations' | 'lastActivity' | 'createdAt';
type SortDir = 'asc' | 'desc';

function compareValues(a: UnifiedDeployment, b: UnifiedDeployment, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case 'name': cmp = a.name.localeCompare(b.name); break;
    case 'target': cmp = a.target.localeCompare(b.target); break;
    case 'status': cmp = a.status.localeCompare(b.status); break;
    case 'invocations': cmp = a.invocations - b.invocations; break;
    case 'lastActivity': cmp = (a.lastActivity ?? '').localeCompare(b.lastActivity ?? ''); break;
    case 'createdAt': cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? ''); break;
  }
  return dir === 'desc' ? -cmp : cmp;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnifiedDeploymentDashboard() {
  const personas = usePersonaStore((s) => s.personas);
  const cloudDeployments = usePersonaStore((s) => s.cloudDeployments);
  const cloudBaseUrl = usePersonaStore((s) => s.cloudBaseUrl);
  const cloudConfig = usePersonaStore((s) => s.cloudConfig);
  const gitlabConfig = usePersonaStore((s) => s.gitlabConfig);
  const gitlabAgents = usePersonaStore((s) => s.gitlabAgents);
  const gitlabSelectedProjectId = usePersonaStore((s) => s.gitlabSelectedProjectId);

  const cloudFetchDeployments = usePersonaStore((s) => s.cloudFetchDeployments);
  const cloudPauseDeploy = usePersonaStore((s) => s.cloudPauseDeploy);
  const cloudResumeDeploy = usePersonaStore((s) => s.cloudResumeDeploy);
  const cloudRemoveDeploy = usePersonaStore((s) => s.cloudRemoveDeploy);
  const gitlabFetchAgents = usePersonaStore((s) => s.gitlabFetchAgents);
  const gitlabUndeployAgent = usePersonaStore((s) => s.gitlabUndeployAgent);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState<DeployTarget | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<DeployStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterOpen, setFilterOpen] = useState(false);

  // Fetch on mount
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

  // Merge both sources into unified rows
  const unified = useMemo<UnifiedDeployment[]>(() => {
    const rows: UnifiedDeployment[] = [];

    for (const d of cloudDeployments) {
      rows.push({
        id: `cloud-${d.id}`,
        target: 'cloud',
        personaName: d.label || personaName(d.persona_id),
        personaId: d.persona_id,
        name: d.label || personaName(d.persona_id),
        status: (d.status === 'active' || d.status === 'paused' || d.status === 'failed' ? d.status : 'unknown') as DeployStatus,
        invocations: d.invocation_count,
        lastActivity: d.last_invoked_at,
        createdAt: d.created_at,
        webUrl: cloudBaseUrl ? `${cloudBaseUrl}/api/deployed/${d.slug}` : null,
        _cloud: d,
      });
    }

    for (const a of gitlabAgents) {
      rows.push({
        id: `gitlab-${a.id}`,
        target: 'gitlab',
        personaName: a.name,
        personaId: null,
        name: a.name,
        status: 'active',
        invocations: 0,
        lastActivity: a.createdAt,
        createdAt: a.createdAt,
        webUrl: a.webUrl,
        _gitlab: a,
        _gitlabProjectId: gitlabSelectedProjectId ?? undefined,
      });
    }

    return rows;
  }, [cloudDeployments, gitlabAgents, cloudBaseUrl, personaName, gitlabSelectedProjectId]);

  // Filter and sort
  const displayRows = useMemo(() => {
    let rows = unified;

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.target.includes(q));
    }
    if (targetFilter !== 'all') {
      rows = rows.filter((r) => r.target === targetFilter);
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((r) => r.status === statusFilter);
    }

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
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); } finally { setBusyId(null); }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Stats
  const totalCloud = unified.filter((r) => r.target === 'cloud').length;
  const totalGitlab = unified.filter((r) => r.target === 'gitlab').length;
  const activeCount = unified.filter((r) => r.status === 'active').length;
  const pausedCount = unified.filter((r) => r.status === 'paused').length;
  const totalInvocations = unified.reduce((sum, r) => sum + r.invocations, 0);

  const cloudConnected = !!cloudConfig?.is_connected;
  const gitlabConnected = !!gitlabConfig?.isConnected;

  return (
<<<<<<< HEAD
    <div className="h-full w-full flex flex-col overflow-hidden">
=======
    <div className="h-full flex flex-col overflow-hidden">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      {/* Header */}
      <div className="px-6 py-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground/90">Deployments</h1>
            <p className="text-sm text-muted-foreground/60 mt-0.5">
              All deployments across Cloud and GitLab
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl
                       bg-secondary/40 border border-primary/15 text-muted-foreground/80
                       hover:text-foreground/95 hover:border-primary/25
                       disabled:opacity-40 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary cards */}
<<<<<<< HEAD
        <div className="grid grid-cols-5 3xl:grid-cols-10 gap-3">
=======
        <div className="grid grid-cols-5 gap-3">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
          <SummaryCard icon={Activity} label="Total" value={unified.length} />
          <SummaryCard icon={CheckCircle2} label="Active" value={activeCount} color="text-emerald-400" />
          <SummaryCard icon={PauseCircle} label="Paused" value={pausedCount} color="text-amber-400" />
          <SummaryCard icon={Cloud} label="Cloud" value={totalCloud} color="text-blue-400" connected={cloudConnected} />
          <SummaryCard icon={GitBranch} label="GitLab" value={totalGitlab} color="text-orange-400" connected={gitlabConnected} />
        </div>

        {/* Search + Filter bar */}
        <div className="flex items-center gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search deployments..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-secondary/40 border border-primary/15
                         text-foreground/80 placeholder:text-muted-foreground/50
                         focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border transition-colors cursor-pointer ${
                targetFilter !== 'all' || statusFilter !== 'all'
                  ? 'bg-primary/10 border-primary/25 text-primary'
                  : 'bg-secondary/40 border-primary/15 text-muted-foreground/80 hover:border-primary/25'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filter
              <ChevronDown className={`w-3 h-3 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>

            {filterOpen && (
              <div className="absolute top-full right-0 mt-1 z-30 bg-background border border-primary/20 rounded-xl shadow-xl p-3 min-w-[200px] space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">Target</label>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(['all', 'cloud', 'gitlab'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setTargetFilter(v)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer ${
                          targetFilter === v
                            ? 'bg-primary/15 border-primary/25 text-primary'
                            : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50'
                        }`}
                      >
                        {v === 'all' ? 'All' : v === 'cloud' ? 'Cloud' : 'GitLab'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">Status</label>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(['all', 'active', 'paused', 'failed'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setStatusFilter(v)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer ${
                          statusFilter === v
                            ? 'bg-primary/15 border-primary/25 text-primary'
                            : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50'
                        }`}
                      >
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-secondary/60 backdrop-blur-sm border-b border-primary/10">
              <tr>
                <SortHeader label="Name" sortKey="name" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Target" sortKey="target" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Invocations" sortKey="invocations" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
                <SortHeader label="Last Activity" sortKey="lastActivity" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Created" sortKey="createdAt" current={sortKey} dir={sortDir} onToggle={toggleSort} />
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/5">
              {displayRows.map((row) => {
                const tb = targetBadge(row.target);
                const TargetIcon = tb.icon;
                const isBusy = busyId === row.id;

                return (
                  <tr key={row.id} className="hover:bg-primary/3 transition-colors">
                    {/* Name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground/90">{row.name}</span>
                    </td>

                    {/* Target */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-lg border ${tb.cls}`}>
                        <TargetIcon className="w-3 h-3" />
                        {tb.label}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-lg border ${statusBadge(row.status)}`}>
                        {statusIcon(row.status)}
                        {row.status}
                      </span>
                    </td>

                    {/* Invocations */}
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground/80">
                      {row.invocations > 0 ? row.invocations.toLocaleString() : '-'}
                    </td>

                    {/* Last Activity */}
                    <td className="px-4 py-3 text-muted-foreground/70">
                      {timeAgo(row.lastActivity)}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3 text-muted-foreground/70">
                      {timeAgo(row.createdAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-0.5">
                        {/* Cloud actions */}
                        {row._cloud && row.status === 'active' && (
                          <ActionButton
                            title="Pause"
                            icon={Pause}
                            hoverColor="hover:text-amber-400 hover:bg-amber-500/10"
                            busy={isBusy}
                            onClick={() => handleAction(row.id, () => cloudPauseDeploy(row._cloud!.id))}
                          />
                        )}
                        {row._cloud && row.status === 'paused' && (
                          <ActionButton
                            title="Resume"
                            icon={Play}
                            hoverColor="hover:text-emerald-400 hover:bg-emerald-500/10"
                            busy={isBusy}
                            onClick={() => handleAction(row.id, () => cloudResumeDeploy(row._cloud!.id))}
                          />
                        )}
                        {row._cloud && (
                          <ActionButton
                            title="Undeploy"
                            icon={Trash2}
                            hoverColor="hover:text-red-400 hover:bg-red-500/10"
                            busy={isBusy}
                            onClick={() => handleAction(row.id, () => cloudRemoveDeploy(row._cloud!.id))}
                          />
                        )}

                        {/* GitLab actions */}
                        {row._gitlab && row._gitlabProjectId && (
                          <ActionButton
                            title="Undeploy"
                            icon={Trash2}
                            hoverColor="hover:text-red-400 hover:bg-red-500/10"
                            busy={isBusy}
                            onClick={() => handleAction(row.id, () => gitlabUndeployAgent(row._gitlabProjectId!, row._gitlab!.id))}
                          />
                        )}

                        {/* Open in browser */}
                        {row.webUrl && (
                          <a
                            href={row.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={row.target === 'gitlab' ? 'Open in GitLab' : 'Open endpoint'}
                            className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground/80 hover:bg-secondary/50 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer stats */}
      {displayRows.length > 0 && (
        <div className="px-6 py-2.5 border-t border-primary/10 flex items-center justify-between text-xs text-muted-foreground/60 flex-shrink-0">
          <span>
            Showing {displayRows.length} of {unified.length} deployment{unified.length !== 1 ? 's' : ''}
          </span>
          <span>
            Total invocations: <span className="text-foreground/80 font-medium">{totalInvocations.toLocaleString()}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  label,
  value,
  color = 'text-foreground/80',
  connected,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  color?: string;
  connected?: boolean;
}) {
  return (
    <div className="px-3 py-2.5 rounded-xl bg-secondary/30 border border-primary/10 flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-secondary/50 border border-primary/15 flex items-center justify-center flex-shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="min-w-0">
        <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground/50 flex items-center gap-1">
          {label}
          {connected !== undefined && (
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
          )}
        </div>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey: key,
  current,
  dir,
  onToggle,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onToggle: (key: SortKey) => void;
  align?: 'right';
}) {
  const isActive = current === key;
  return (
    <th
      className={`px-4 py-2.5 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider cursor-pointer hover:text-muted-foreground/90 transition-colors select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onToggle(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground/50'}`} />
        {isActive && (
          <span className="text-primary text-[10px]">{dir === 'asc' ? '\u2191' : '\u2193'}</span>
        )}
      </span>
    </th>
  );
}

function ActionButton({
  title,
  icon: Icon,
  hoverColor,
  busy,
  onClick,
}: {
  title: string;
  icon: typeof Pause;
  hoverColor: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className={`p-1.5 rounded-lg text-muted-foreground/50 ${hoverColor} disabled:opacity-40 transition-colors cursor-pointer`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
    </button>
  );
}

export default UnifiedDeploymentDashboard;
