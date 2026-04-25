import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, GitBranch, AlertTriangle, ExternalLink,
  RefreshCw, CheckCircle2, AlertCircle, Key,
  CircleDot, GitPullRequest, GitCommitHorizontal, Shield,
  Bug, Activity, BarChart3, Link2, Save,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
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
  fetchSentryOrgs,
  fetchSentryProjects,
  splitSentrySlug,
  type RepoStats,
  type MonitoringStats,
  type RepoProvider,
  type SentryOrg,
  type SentryProject,
} from './adapters';

// ---------------------------------------------------------------------------
// Error formatting — Tauri rejects with serialized `AppError` *objects*, not
// JS Error instances. `String(obj)` becomes "[object Object]", so we have to
// normalize manually before showing anything to the user.
// ---------------------------------------------------------------------------

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    // Tauri AppError variants are { Variant: "msg" } — surface the inner string.
    for (const v of Object.values(obj)) {
      if (typeof v === 'string') return v;
    }
    try { return JSON.stringify(obj); } catch { /* fall through */ }
  }
  return String(err);
}

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
        <p className="typo-data-lg text-primary leading-tight truncate">{value}</p>
        <p className="typo-caption text-foreground truncate">{label}</p>
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
  errorMessage,
  onAction,
  actionLabel,
  children,
}: {
  title: string;
  state: ConnectionState;
  serviceName: string;
  errorMessage?: string | null;
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
        <span className="typo-body text-foreground">{po.loading_stats}</span>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="rounded-card border border-primary/10 bg-card/30 p-6 text-center">
        <Key className="w-8 h-8 text-foreground mx-auto mb-3" />
        <p className="typo-body text-foreground mb-3">
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
          <span className="typo-body font-medium text-foreground">{po.credential_found.replace('{{service}}', serviceName)}</span>
        </div>
        {children}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded-card border border-red-500/20 bg-red-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="typo-body font-medium text-foreground">{po.failed_to_load}</p>
            {errorMessage && (
              <p className="typo-caption text-foreground mt-1 break-words">{errorMessage}</p>
            )}
          </div>
        </div>
        {onAction && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={onAction}>
              {po.retry}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // connected
  return (
    <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="typo-body font-medium text-foreground">{serviceName}</span>
        <span className="typo-caption text-emerald-400 ml-auto">{po.connected}</span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector chain — visualises plugin → project → URL → credential so the
// user understands (and can edit) which credential is providing the data.
// ---------------------------------------------------------------------------

function ConnectorChain({
  projectName,
  url,
  credentials,
  activeCredId,
  onPickCred,
  onEditUrl,
}: {
  projectName: string;
  url: string | null;
  credentials: PersonaCredential[];
  activeCredId: string | null;
  onPickCred: (id: string) => void;
  onEditUrl: () => void;
}) {
  const activeCred = credentials.find((c) => c.id === activeCredId);
  return (
    <div className="rounded-modal border border-primary/10 bg-card/30 px-3 py-2.5">
      <p className="typo-caption uppercase tracking-[0.18em] text-foreground/60 mb-2">
        Connection chain
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Project */}
        <span className="inline-flex items-center gap-1 typo-caption text-foreground">
          <LayoutDashboard className="w-3 h-3 text-primary" />
          <span className="font-medium">{projectName}</span>
        </span>
        <ChevronArrow />

        {/* URL */}
        <button
          type="button"
          onClick={onEditUrl}
          className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-primary transition-colors"
          title="Edit project to change the repo URL"
        >
          <GitBranch className="w-3 h-3 text-blue-400" />
          {url ? <span className="font-mono truncate max-w-[260px]">{url}</span> : <span className="text-amber-400">no repo URL</span>}
          <ExternalLink className="w-3 h-3 opacity-60" />
        </button>
        <ChevronArrow />

        {/* Credential */}
        {credentials.length === 0 ? (
          <span className="inline-flex items-center gap-1 typo-caption text-amber-400">
            <Key className="w-3 h-3" /> no credential
          </span>
        ) : credentials.length === 1 ? (
          <span className="inline-flex items-center gap-1 typo-caption text-foreground">
            <Key className="w-3 h-3 text-emerald-400" />
            <span className="font-medium">{credentials[0]!.name}</span>
            <span className="text-foreground/50 font-mono">({credentials[0]!.service_type})</span>
          </span>
        ) : (
          <div className="inline-flex items-center gap-1">
            <Key className="w-3 h-3 text-emerald-400" />
            <select
              value={activeCredId ?? credentials[0]!.id}
              onChange={(e) => onPickCred(e.target.value)}
              className="px-1.5 py-0.5 typo-caption bg-secondary/40 border border-primary/10 rounded-card text-foreground"
            >
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.service_type})</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {activeCred && (
        <p className="typo-caption text-foreground/50 mt-1.5">
          Stats are fetched through the API proxy using this credential's auth.
        </p>
      )}
    </div>
  );
}

function ChevronArrow() {
  return <span className="typo-caption text-foreground/40 select-none">→</span>;
}

function MonitoringChain({
  projectName,
  credential,
  slug,
}: {
  projectName: string;
  credential: PersonaCredential | null;
  slug: string | null;
}) {
  const [orgSlug, projectSlug] = splitSentrySlug(slug);
  return (
    <div className="rounded-modal border border-primary/10 bg-card/30 px-3 py-2.5">
      <p className="typo-caption uppercase tracking-[0.18em] text-foreground/60 mb-2">
        Connection chain
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 typo-caption text-foreground">
          <LayoutDashboard className="w-3 h-3 text-primary" />
          <span className="font-medium">{projectName}</span>
        </span>
        <ChevronArrow />
        {credential ? (
          <span className="inline-flex items-center gap-1 typo-caption text-foreground">
            <Key className="w-3 h-3 text-emerald-400" />
            <span className="font-medium">{credential.name}</span>
            <span className="text-foreground/50 font-mono">({credential.service_type})</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 typo-caption text-amber-400">
            <Key className="w-3 h-3" /> no credential linked
          </span>
        )}
        {credential && (
          <>
            <ChevronArrow />
            {projectSlug ? (
              <span className="inline-flex items-center gap-1 typo-caption text-foreground">
                <Shield className="w-3 h-3 text-red-400" />
                <span className="font-mono">{orgSlug ? `${orgSlug}/${projectSlug}` : projectSlug}</span>
              </span>
            ) : (
              <span className="typo-caption text-amber-400">no project slug</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sentry org + project picker (replaces the old free-text MonitoringLinkForm)
// ---------------------------------------------------------------------------

function SentryProjectPicker({
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
  const [orgs, setOrgs] = useState<SentryOrg[]>([]);
  const [orgSlug, setOrgSlug] = useState('');
  const [projects, setProjects] = useState<SentryProject[]>([]);
  const [projectSlug, setProjectSlug] = useState('');
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset downstream selection when the credential changes
  useEffect(() => {
    setOrgs([]); setOrgSlug(''); setProjects([]); setProjectSlug('');
    setDiscoveryError(null); setManualMode(false);
  }, [selectedCredId]);

  // Discover organizations for the selected credential
  useEffect(() => {
    if (!selectedCredId || manualMode) return;
    let cancelled = false;
    setLoadingOrgs(true);
    setDiscoveryError(null);
    fetchSentryOrgs(selectedCredId)
      .then((list) => {
        if (cancelled) return;
        setOrgs(list);
        if (list.length === 1 && list[0]) setOrgSlug(list[0].slug);
      })
      .catch((err) => {
        if (cancelled) return;
        // Auto-flip to manual entry — discovery is a convenience, not a gate.
        setDiscoveryError(formatErr(err));
        setManualMode(true);
      })
      .finally(() => { if (!cancelled) setLoadingOrgs(false); });
    return () => { cancelled = true; };
  }, [selectedCredId, manualMode]);

  // Discover projects when an org is selected (skipped in manual mode)
  useEffect(() => {
    if (!selectedCredId || !orgSlug || manualMode) return;
    let cancelled = false;
    setLoadingProjects(true);
    setProjects([]); setProjectSlug('');
    fetchSentryProjects(selectedCredId, orgSlug)
      .then((list) => { if (!cancelled) setProjects(list); })
      .catch((err) => {
        if (cancelled) return;
        setDiscoveryError(formatErr(err));
        setManualMode(true);
      })
      .finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [selectedCredId, orgSlug, manualMode]);

  const handleSave = async () => {
    if (!selectedCredId || !orgSlug || !projectSlug) return;
    setSaving(true);
    try {
      await updateProject(projectId, {
        monitoringCredentialId: selectedCredId,
        // Persisted as `org/project` so we don't need a new column.
        monitoringProjectSlug: `${orgSlug}/${projectSlug}`,
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
      <p className="typo-caption text-foreground">{po.link_monitoring}</p>

      {credentials.length > 1 && (
        <div className="space-y-1">
          <label className="typo-caption text-foreground/70">Credential</label>
          <select
            value={selectedCredId}
            onChange={(e) => setSelectedCredId(e.target.value)}
            className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground"
          >
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {manualMode ? (
        <>
          <div className="space-y-1">
            <label className="typo-caption text-foreground/70">Organization slug</label>
            <input
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value.trim())}
              placeholder="my-org"
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="typo-caption text-foreground/70">Project slug</label>
            <input
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value.trim())}
              placeholder="my-project"
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-ring"
            />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <label className="typo-caption text-foreground/70">Organization</label>
            <select
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              disabled={loadingOrgs || orgs.length === 0}
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground disabled:opacity-60"
            >
              <option value="" disabled>
                {loadingOrgs ? 'Discovering organizations…' : orgs.length === 0 ? 'No orgs found' : 'Select an organization'}
              </option>
              {orgs.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name} ({o.slug})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="typo-caption text-foreground/70">Project</label>
            <select
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              disabled={loadingProjects || !orgSlug || projects.length === 0}
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground disabled:opacity-60"
            >
              <option value="" disabled>
                {!orgSlug ? 'Pick an organization first' : loadingProjects ? 'Loading projects…' : projects.length === 0 ? 'No projects in this org' : 'Select a project'}
              </option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>
              ))}
            </select>
          </div>
        </>
      )}

      {discoveryError && (
        <div className="flex items-start gap-2 p-2 rounded-modal bg-red-500/5 border border-red-500/15">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="typo-caption text-foreground break-words">
              Sentry discovery failed: {discoveryError}
            </p>
            <p className="typo-caption text-foreground/60 mt-1">
              Enter the slugs manually below — find them in your Sentry URL: <span className="font-mono">sentry.io/organizations/<b>your-org</b>/projects/<b>your-project</b>/</span>
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setManualMode((m) => !m);
          setDiscoveryError(null);
          setOrgSlug(''); setProjectSlug('');
        }}
        className="typo-caption text-foreground/70 hover:text-foreground underline-offset-2 hover:underline"
      >
        {manualMode ? 'Try auto-discovery again' : 'Enter slugs manually instead'}
      </button>


      <div className="flex justify-end">
        <Button
          variant="accent"
          accentColor="emerald"
          size="sm"
          icon={<Save className="w-3 h-3" />}
          onClick={handleSave}
          loading={saving}
          disabled={!orgSlug || !projectSlug}
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
  const [repoError, setRepoError] = useState<string | null>(null);
  // The credential currently being used to fetch repo stats. Surfaced in the
  // UI so the "plugin → project → connector → credential" chain is visible.
  const [activeRepoCredId, setActiveRepoCredId] = useState<string | null>(null);

  // Monitoring stats
  const [monitorState, setMonitorState] = useState<ConnectionState>('loading');
  const [monitorStats, setMonitorStats] = useState<MonitoringStats | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);

  // Load credentials once
  useEffect(() => {
    listCredentials().then((creds) => {
      setCredentials(creds);
      setCredLoaded(true);
    }).catch(() => setCredLoaded(true));
  }, []);

  // Recognize a credential as GitHub-capable. Beyond the canonical service_type
  // values from the catalog we also probe the credential metadata's
  // platform_type — covers user-renamed credentials and OAuth-imported ones
  // where the legacy matcher would otherwise leak past the filter.
  const isGitHubCred = (c: PersonaCredential) => {
    if (c.service_type === 'github' || c.service_type === 'github_actions') return true;
    if (!c.metadata) return false;
    try {
      const meta = JSON.parse(c.metadata);
      return meta?.platform_type === 'github' || meta?.platform_type === 'github_actions';
    } catch { return false; }
  };
  const isGitLabCred = (c: PersonaCredential) => {
    if (c.service_type === 'gitlab') return true;
    if (!c.metadata) return false;
    try {
      const meta = JSON.parse(c.metadata);
      return meta?.platform_type === 'gitlab';
    } catch { return false; }
  };
  const repoCreds = credentials.filter((c) => isGitHubCred(c) || isGitLabCred(c));
  const sentryCreds = credentials.filter((c) => c.service_type === 'sentry');

  // Fetch repo stats
  const loadRepoStats = useCallback(async () => {
    if (!activeProject?.github_url || !credLoaded) return;

    const url = activeProject.github_url;
    const provider = detectRepoProvider(url);
    setRepoProvider(provider);
    setRepoError(null);

    if (!provider) {
      setRepoState('error');
      setRepoError(`Cannot detect repo provider from URL: ${url}`);
      return;
    }

    // Use whichever credential the user has selected (if multiple are
    // available); otherwise auto-pick the first matching one.
    const stickyCred = activeRepoCredId ? credentials.find((c) => c.id === activeRepoCredId) : undefined;
    const matchesProvider = (c: PersonaCredential) => provider === 'github' ? isGitHubCred(c) : isGitLabCred(c);
    const cred = (stickyCred && matchesProvider(stickyCred)) ? stickyCred
      : credentials.find(matchesProvider);
    if (!cred) {
      setRepoState('unmapped');
      setActiveRepoCredId(null);
      return;
    }
    setActiveRepoCredId(cred.id);

    setRepoState('loading');
    try {
      let stats: RepoStats;
      if (provider === 'github') {
        const parsed = parseGitHubUrl(url);
        if (!parsed) { setRepoState('error'); setRepoError(`Could not parse GitHub URL: ${url}`); return; }
        stats = await fetchGitHubStats(cred.id, parsed.owner, parsed.repo);
      } else {
        const parsed = parseGitLabUrl(url);
        if (!parsed) { setRepoState('error'); setRepoError(`Could not parse GitLab URL: ${url}`); return; }
        stats = await fetchGitLabStats(cred.id, parsed.path);
      }
      setRepoStats(stats);
      setRepoState('connected');
    } catch (err) {
      setRepoState('error');
      setRepoError(formatErr(err));
    }
  }, [activeProject?.github_url, credentials, credLoaded, activeRepoCredId]);

  // Fetch monitoring stats
  const loadMonitorStats = useCallback(async () => {
    if (!activeProject || !credLoaded) return;

    const credId = activeProject.monitoring_credential_id;
    const slug = activeProject.monitoring_project_slug;
    setMonitorError(null);

    if (!credId || !slug) {
      setMonitorState(sentryCreds.length > 0 ? 'unmapped' : 'empty');
      return;
    }

    const cred = credentials.find((c) => c.id === credId);
    if (!cred) {
      setMonitorState('unmapped');
      return;
    }

    setMonitorState('loading');
    try {
      const [storedOrg, storedProject] = splitSentrySlug(slug);
      let orgSlug = storedOrg;
      const projectSlug = storedProject ?? slug;

      // Backfill for legacy entries that only stored the project slug — discover
      // the org via the API instead of guessing from the credential name.
      if (!orgSlug) {
        const orgs = await fetchSentryOrgs(credId);
        if (orgs.length === 1 && orgs[0]) orgSlug = orgs[0].slug;
        else throw new Error('Org slug missing — re-link this monitoring connection.');
      }

      const stats = await fetchSentryStats(credId, orgSlug, projectSlug);
      setMonitorStats(stats);
      setMonitorState('connected');
    } catch (err) {
      setMonitorState('error');
      setMonitorError(formatErr(err));
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
      />

      <ContentBody>
        <ActionRow>
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
        </ActionRow>

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

            {/* Connector chain — makes plugin → project → URL → credential visible */}
            {(repoState === 'connected' || repoState === 'error' || repoState === 'unmapped') && (
              <ConnectorChain
                projectName={activeProject.name}
                url={activeProject.github_url ?? null}
                credentials={repoCreds}
                activeCredId={activeRepoCredId}
                onPickCred={(id) => { setActiveRepoCredId(id); }}
                onEditUrl={() => setDevToolsTab('projects')}
              />
            )}

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
                serviceName={repoCreds.length > 0 ? (isGitLabCred(repoCreds[0]!) ? 'GitLab' : 'GitHub') : 'GitHub'}
              >
                <p className="typo-caption text-foreground mt-1">{po.set_repo_url}</p>
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
                errorMessage={repoError}
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
                  <p className="typo-caption text-foreground mt-2">
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

            {/* Connector chain — same wiring view as Codebase */}
            {(monitorState === 'connected' || monitorState === 'error' || monitorState === 'unmapped') && (
              <MonitoringChain
                projectName={activeProject.name}
                credential={
                  activeProject.monitoring_credential_id
                    ? credentials.find((c) => c.id === activeProject.monitoring_credential_id) ?? null
                    : null
                }
                slug={activeProject.monitoring_project_slug ?? null}
              />
            )}

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
                <SentryProjectPicker
                  credentials={sentryCreds}
                  projectId={activeProject.id}
                  onLinked={() => {
                    fetchProjects();
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
                errorMessage={monitorError}
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
                    value={splitSentrySlug(activeProject.monitoring_project_slug)[1] ?? '-'}
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
