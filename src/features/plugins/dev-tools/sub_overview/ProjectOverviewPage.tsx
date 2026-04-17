import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, GitBranch, AlertTriangle, ExternalLink,
  RefreshCw, CheckCircle2, AlertCircle, Key,
  CircleDot, GitPullRequest, GitCommitHorizontal, Shield,
  Bug, Activity, BarChart3, Link2, Save,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { listCredentials } from '@/api/vault/credentials';
import { updateProject } from '@/api/devTools/devTools';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import {
  detectRepoProvider,
  parseGitHubUrl,
  parseGitLabUrl,
  fetchGitHubStats,
  fetchGitLabStats,
  fetchSentryStats,
  type RepoStats,
  type MonitoringStats,
  type RepoProvider,
} from './adapters';

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

type StatColor = 'amber' | 'blue' | 'violet' | 'emerald' | 'red' | 'primary';

// Static class bundles so Tailwind's JIT can detect every class at build time.
// Dynamic template strings like `bg-${color}-500/15` are invisible to the JIT
// and silently produce no styles, which is why the overview stat tiles had no
// background color before.
const STAT_COLORS: Record<StatColor, { bg: string; border: string; icon: string }> = {
  amber: { bg: 'bg-amber-500/15', border: 'border-amber-500/25', icon: 'text-amber-400' },
  blue: { bg: 'bg-blue-500/15', border: 'border-blue-500/25', icon: 'text-blue-400' },
  violet: { bg: 'bg-violet-500/15', border: 'border-violet-500/25', icon: 'text-violet-400' },
  emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', icon: 'text-emerald-400' },
  red: { bg: 'bg-red-500/15', border: 'border-red-500/25', icon: 'text-red-400' },
  primary: { bg: 'bg-primary/15', border: 'border-primary/25', icon: 'text-primary' },
};

function StatCard({
  icon: Icon,
  value,
  label,
  color = 'primary',
}: {
  icon: typeof CircleDot;
  value: string | number;
  label: string;
  color?: StatColor;
}) {
  const tw = STAT_COLORS[color] ?? STAT_COLORS.primary;
  return (
    <div className="rounded-modal border border-primary/10 bg-card/30 p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-interactive ${tw.bg} border ${tw.border} flex items-center justify-center shrink-0`}>
        <Icon className={`w-4.5 h-4.5 ${tw.icon}`} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold text-primary leading-tight truncate">{value}</p>
        <p className="text-[11px] text-foreground truncate">{label}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection status card
// ---------------------------------------------------------------------------

type ConnectionState = 'empty' | 'unmapped' | 'connected' | 'loading' | 'error';

function ConnectionCard({
  title,
  state,
  serviceName,
  onAction,
  actionLabel,
  children,
}: {
  title: string;
  state: ConnectionState;
  serviceName: string;
  onAction?: () => void;
  actionLabel?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const po = t.project_overview;

  if (state === 'loading') {
    return (
      <div className="rounded-card border border-primary/10 bg-card/30 p-6 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
        <span className="text-md text-foreground">{po.loading_stats}</span>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="rounded-card border border-primary/10 bg-card/30 p-6 text-center">
        <Key className="w-8 h-8 text-foreground mx-auto mb-3" />
        <p className="text-md text-foreground mb-3">
          {po.connect_to_see_stats.replace('{{service}}', serviceName).replace('{{category}}', title.toLowerCase())}
        </p>
        {onAction && (
          <Button variant="secondary" size="sm" onClick={onAction}>
            {actionLabel ?? po.go_to_connections}
          </Button>
        )}
      </div>
    );
  }

  if (state === 'unmapped') {
    return (
      <div className="rounded-card border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-md font-medium text-foreground">{po.credential_found.replace('{{service}}', serviceName)}</span>
        </div>
        {children}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded-card border border-red-500/20 bg-red-500/5 p-5 text-center">
        <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-md text-foreground mb-3">{po.failed_to_load}</p>
        {onAction && (
          <Button variant="secondary" size="sm" onClick={onAction}>
            {po.retry}
          </Button>
        )}
      </div>
    );
  }

  // connected
  return (
    <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="text-md font-medium text-foreground">{serviceName}</span>
        <span className="text-[10px] text-emerald-400 ml-auto">{po.connected}</span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitoring link form (inline)
// ---------------------------------------------------------------------------

function MonitoringLinkForm({
  credentials,
  projectId,
  onLinked,
}: {
  credentials: PersonaCredential[];
  projectId: string;
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const po = t.project_overview;
  const addToast = useToastStore((s) => s.addToast);
  const [selectedCredId, setSelectedCredId] = useState(credentials[0]?.id ?? '');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedCredId || !slug.trim()) return;
    setSaving(true);
    try {
      await updateProject(projectId, {
        monitoringCredentialId: selectedCredId,
        monitoringProjectSlug: slug.trim(),
      });
      onLinked();
      addToast('Monitoring linked', 'success');
    } catch {
      addToast('Failed to link monitoring', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <p className="text-xs text-foreground">{po.link_monitoring}</p>
      {credentials.length > 1 && (
        <select
          value={selectedCredId}
          onChange={(e) => setSelectedCredId(e.target.value)}
          className="w-full px-3 py-2 text-xs bg-secondary/40 border border-primary/10 rounded-modal text-foreground"
        >
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={po.project_slug_placeholder}
          className="flex-1 px-3 py-2 text-xs bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground"
        />
        <Button
          variant="accent"
          accentColor="emerald"
          size="sm"
          icon={<Save className="w-3 h-3" />}
          onClick={handleSave}
          loading={saving}
          disabled={!slug.trim()}
        >
          {po.save}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProjectOverviewPage() {
  const { t } = useTranslation();
  const po = t.project_overview;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  // Credentials
  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [credLoaded, setCredLoaded] = useState(false);

  // Repo stats
  const [repoState, setRepoState] = useState<ConnectionState>('loading');
  const [repoProvider, setRepoProvider] = useState<RepoProvider | null>(null);
  const [repoStats, setRepoStats] = useState<RepoStats | null>(null);

  // Monitoring stats
  const [monitorState, setMonitorState] = useState<ConnectionState>('loading');
  const [monitorStats, setMonitorStats] = useState<MonitoringStats | null>(null);

  // Load credentials once
  useEffect(() => {
    listCredentials().then((creds) => {
      setCredentials(creds);
      setCredLoaded(true);
    }).catch(() => setCredLoaded(true));
  }, []);

  // Derive connection state for codebase
  const repoCreds = credentials.filter(
    (c) => c.service_type === 'github' || c.service_type === 'github_actions' || c.service_type === 'gitlab',
  );
  const sentryCreds = credentials.filter((c) => c.service_type === 'sentry');

  // Fetch repo stats
  const loadRepoStats = useCallback(async () => {
    if (!activeProject?.github_url || !credLoaded) return;

    const url = activeProject.github_url;
    const provider = detectRepoProvider(url);
    setRepoProvider(provider);

    if (!provider) {
      setRepoState('unmapped');
      return;
    }

    // Find matching credential
    const matchType = provider === 'github' ? ['github', 'github_actions'] : ['gitlab'];
    const cred = credentials.find((c) => matchType.includes(c.service_type));
    if (!cred) {
      setRepoState('unmapped');
      return;
    }

    setRepoState('loading');
    try {
      let stats: RepoStats;
      if (provider === 'github') {
        const parsed = parseGitHubUrl(url);
        if (!parsed) { setRepoState('error'); return; }
        stats = await fetchGitHubStats(cred.id, parsed.owner, parsed.repo);
      } else {
        const parsed = parseGitLabUrl(url);
        if (!parsed) { setRepoState('error'); return; }
        stats = await fetchGitLabStats(cred.id, parsed.path);
      }
      setRepoStats(stats);
      setRepoState('connected');
    } catch {
      setRepoState('error');
    }
  }, [activeProject?.github_url, credentials, credLoaded]);

  // Fetch monitoring stats
  const loadMonitorStats = useCallback(async () => {
    if (!activeProject || !credLoaded) return;

    const credId = activeProject.monitoring_credential_id;
    const slug = activeProject.monitoring_project_slug;

    if (!credId || !slug) {
      setMonitorState(sentryCreds.length > 0 ? 'unmapped' : 'empty');
      return;
    }

    // Find the org slug from the credential metadata
    const cred = credentials.find((c) => c.id === credId);
    if (!cred) {
      setMonitorState('unmapped');
      return;
    }

    setMonitorState('loading');
    try {
      // For Sentry, the org slug comes from the credential metadata
      // We'll use the credential name as a fallback, or try to extract from metadata
      const orgSlug = cred.name.toLowerCase().replace(/\s+/g, '-');
      const stats = await fetchSentryStats(credId, orgSlug, slug);
      setMonitorStats(stats);
      setMonitorState('connected');
    } catch {
      setMonitorState('error');
    }
  }, [activeProject, credentials, credLoaded, sentryCreds.length]);

  useEffect(() => {
    if (!credLoaded || !activeProject) return;

    if (activeProject.github_url) {
      loadRepoStats();
    } else {
      setRepoState(repoCreds.length > 0 ? 'unmapped' : 'empty');
    }

    loadMonitorStats();
  }, [credLoaded, activeProject, loadRepoStats, loadMonitorStats, repoCreds.length]);

  // No project selected
  if (!activeProjectId || !activeProject) {
    return (
      <ContentBox>
        <ContentHeader
          icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
          iconColor="primary"
          title={po.codebase}
        />
        <ContentBody centered>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <LayoutDashboard className="w-10 h-10 text-foreground mb-3" />
            <p className="typo-section-title">{po.no_project_selected}</p>
            <p className="typo-body text-foreground mt-1">{po.select_project_hint}</p>
          </div>
        </ContentBody>
      </ContentBox>
    );
  }

  const isGitLab = repoProvider === 'gitlab';

  return (
    <ContentBox>
      <ContentHeader
        icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={activeProject.name}
        subtitle={activeProject.root_path}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => {
              fetchProjects();
              loadRepoStats();
              loadMonitorStats();
            }}
          >
            {po.retry}
          </Button>
        }
      />

      <ContentBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
          {/* ============================================================ */}
          {/* LEFT: Codebase                                               */}
          {/* ============================================================ */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-blue-400" />
              <h2 className="typo-section-title">
                {po.codebase}
              </h2>
            </div>

            {repoState === 'empty' && (
              <ConnectionCard
                title={po.codebase}
                state="empty"
                serviceName="GitHub / GitLab"
                onAction={() => setSidebarSection('credentials')}
              />
            )}

            {repoState === 'unmapped' && (
              <ConnectionCard
                title={po.codebase}
                state="unmapped"
                serviceName={repoCreds.length > 0 ? (repoCreds[0]!.service_type === 'gitlab' ? 'GitLab' : 'GitHub') : 'GitHub'}
              >
                <p className="text-xs text-foreground mt-1">{po.set_repo_url}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  icon={<ExternalLink className="w-3 h-3" />}
                  onClick={() => setDevToolsTab('projects')}
                >
                  {po.go_to_projects}
                </Button>
              </ConnectionCard>
            )}

            {repoState === 'loading' && (
              <ConnectionCard title={po.codebase} state="loading" serviceName="" />
            )}

            {repoState === 'error' && (
              <ConnectionCard
                title={po.codebase}
                state="error"
                serviceName=""
                onAction={loadRepoStats}
              />
            )}

            {repoState === 'connected' && repoStats && (
              <ConnectionCard
                title={po.codebase}
                state="connected"
                serviceName={isGitLab ? 'GitLab' : 'GitHub'}
              >
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    icon={CircleDot}
                    value={repoStats.openIssues}
                    label={po.open_issues}
                    color="amber"
                  />
                  <StatCard
                    icon={GitPullRequest}
                    value={repoStats.openPullRequests}
                    label={isGitLab ? po.open_mrs : po.open_prs}
                    color="blue"
                  />
                  <StatCard
                    icon={GitCommitHorizontal}
                    value={repoStats.commitsLastWeek}
                    label={po.commits_this_week}
                    color="violet"
                  />
                  <StatCard
                    icon={GitBranch}
                    value={repoStats.defaultBranch}
                    label={po.default_branch}
                    color="emerald"
                  />
                </div>
                {repoStats.lastPushAt && (
                  <p className="text-[10px] text-foreground mt-2">
                    {po.last_push}: {new Date(repoStats.lastPushAt).toLocaleDateString()}
                  </p>
                )}
              </ConnectionCard>
            )}
          </div>

          {/* ============================================================ */}
          {/* RIGHT: Monitoring                                            */}
          {/* ============================================================ */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-red-400" />
              <h2 className="typo-section-title">
                {po.monitoring}
              </h2>
            </div>

            {monitorState === 'empty' && (
              <ConnectionCard
                title={po.monitoring}
                state="empty"
                serviceName="Sentry"
                onAction={() => setSidebarSection('credentials')}
              />
            )}

            {monitorState === 'unmapped' && (
              <ConnectionCard
                title={po.monitoring}
                state="unmapped"
                serviceName="Sentry"
              >
                <MonitoringLinkForm
                  credentials={sentryCreds}
                  projectId={activeProject.id}
                  onLinked={() => {
                    fetchProjects();
                    // Re-trigger monitoring load after project is updated
                    setTimeout(() => loadMonitorStats(), 500);
                  }}
                />
              </ConnectionCard>
            )}

            {monitorState === 'loading' && (
              <ConnectionCard title={po.monitoring} state="loading" serviceName="" />
            )}

            {monitorState === 'error' && (
              <ConnectionCard
                title={po.monitoring}
                state="error"
                serviceName=""
                onAction={loadMonitorStats}
              />
            )}

            {monitorState === 'connected' && monitorStats && (
              <ConnectionCard
                title={po.monitoring}
                state="connected"
                serviceName="Sentry"
              >
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    icon={Bug}
                    value={monitorStats.unresolvedIssues}
                    label={po.unresolved_issues}
                    color="red"
                  />
                  <StatCard
                    icon={Activity}
                    value={monitorStats.eventsLast24h}
                    label={po.events_24h}
                    color="amber"
                  />
                  <StatCard
                    icon={BarChart3}
                    value={monitorStats.eventsLastWeek}
                    label={po.events_7d}
                    color="blue"
                  />
                  <StatCard
                    icon={Link2}
                    value={activeProject.monitoring_project_slug ?? '-'}
                    label={po.project_slug}
                    color="violet"
                  />
                </div>
              </ConnectionCard>
            )}
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
