import { useState, useEffect, useMemo, type DragEvent } from 'react';
import { motion } from 'framer-motion';
import {
  GitBranch, RefreshCw,
  CircleDot, GitPullRequest, GitCommitHorizontal,
  Bug, Activity, BarChart3, Shield, Key,
  Code2, AlertCircle, CheckCircle2, ExternalLink, LayoutDashboard,
  Settings, ScanSearch, Sparkles, XCircle, Target,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { splitSentrySlug } from './adapters';
import {
  ConnectorChain, MonitoringChain, SentryProjectPicker,
} from './OverviewParts';
import { useOverviewData } from './useOverviewData';
import { usePipelineStore } from '@/stores/pipelineStore';
import { ProjectPipelineView } from '../sub_projects/pipeline/ProjectPipelineView';
import { StandardsScanCard } from './StandardsScanCard';

// Re-export shared helpers so existing call sites keep resolving.
export { formatErr } from './overviewHelpers';
import { buildTodayActivity, type ActivityEvent, type ActivityKind } from './overviewHelpers';
import { silentCatch } from '@/lib/silentCatch';
import { DebtText, debtText } from '@/i18n/DebtText';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';



// ---------------------------------------------------------------------------
// Vital-tile ordering — persisted per project so each project can keep its
// own "most-watched first" layout.
// ---------------------------------------------------------------------------

type TileId = 'open_issues' | 'open_prs' | 'commits' | 'unresolved' | 'events_24h' | 'events_7d';
const DEFAULT_TILE_ORDER: TileId[] = ['open_issues', 'open_prs', 'commits', 'unresolved', 'events_24h', 'events_7d'];

function tileOrderStorageKey(projectId: string): string {
  return `personas.devtools.overview_tile_order.${projectId}`;
}

function readTileOrder(projectId: string): TileId[] {
  try {
    const raw = localStorage.getItem(tileOrderStorageKey(projectId));
    if (!raw) return DEFAULT_TILE_ORDER;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TILE_ORDER;
    const valid = new Set<TileId>(DEFAULT_TILE_ORDER);
    const ordered = parsed.filter((x): x is TileId => typeof x === 'string' && valid.has(x as TileId));
    // Append any tile ids missing from persisted order (e.g. after a future
    // tile is added) so the user never loses a metric to legacy state.
    for (const id of DEFAULT_TILE_ORDER) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  } catch {
    return DEFAULT_TILE_ORDER;
  }
}

function writeTileOrder(projectId: string, order: TileId[]): void {
  try {
    localStorage.setItem(tileOrderStorageKey(projectId), JSON.stringify(order));
  } catch (err) { silentCatch("features/plugins/dev-tools/sub_overview/ProjectOverviewPage:catch1")(err); }
}

/**
 * Dev-tools Overview — glance-first health dashboard ("Pulse" layout).
 *
 * Mental model: mission-control panel. The user answers "is my project OK
 * right now?" in <2 seconds.
 *
 * Layout:
 *   - Header: project identity + LifecycleProjectPicker + an animated
 *     "vital sign" status dot + global Refresh in actions row.
 *   - Hero strip (top): 6 vital-signs tiles in a single row using large
 *     numerals (typo-data-lg) with status-token tinting based on threshold.
 *   - Connections rail (below): one compact row per integration showing
 *     the credential + key context inline. The full connection chain is
 *     hidden behind a per-row cog so it's available without dominating
 *     the layout.
 */
export default function ProjectOverviewPage() {
  const { t } = useTranslation();
  const po = t.project_overview;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  // Teams roster — resolves the bound team's display name for the read-only
  // pipeline section's Source-control stage.
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeamsForPipeline = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => { void fetchTeamsForPipeline(); }, [fetchTeamsForPipeline]);

  const data = useOverviewData();
  const {
    activeProjectId, activeProject, credentials, repoCreds, sentryCreds,
    repoState, repoProvider, repoStats, repoError,
    activeRepoCredId, setActiveRepoCredId,
    monitorState, monitorStats, monitorError,
    loadRepoStats, loadMonitorStats, refresh,
  } = data;

  const [showRepoChain, setShowRepoChain] = useState(false);
  const [showMonitorChain, setShowMonitorChain] = useState(false);

  // Track when the vital signs last settled so the header can show a live
  // "updated Nm ago" instead of a static placeholder. Bumps whenever fresh
  // repo or monitor stats land (initial load, manual refresh, project switch).
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  useEffect(() => {
    if (data.repoStats || data.monitorStats) setLastLoadedAt(Date.now());
  }, [data.repoStats, data.monitorStats]);
  const statsLoading = data.repoState === 'loading' || data.monitorState === 'loading';

  // Cross-tab "What changed today" feed — pulls from the same store slices
  // that power Scanner / Triage / Task Runner / Lifecycle, then dedupes,
  // sorts, and surfaces in one chronological list on the Overview tab.
  const storeScans = useSystemStore((s) => s.scans ?? []);
  const storeTasksForToday = useSystemStore((s) => s.tasks);
  const storeSignals = useSystemStore((s) => s.goalSignals);
  const fetchScansForToday = useSystemStore((s) => s.fetchScans);
  const fetchTasksForToday = useSystemStore((s) => s.fetchTasks);
  useEffect(() => {
    if (!activeProjectId) return;
    fetchScansForToday(activeProjectId);
    fetchTasksForToday(activeProjectId);
  }, [activeProjectId, fetchScansForToday, fetchTasksForToday]);
  const todayActivity = useMemo(
    () => buildTodayActivity(storeScans, storeTasksForToday, storeSignals),
    [storeScans, storeTasksForToday, storeSignals],
  );

  const setPendingTaskFocusId = useSystemStore((s) => s.setPendingTaskFocusId);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);
  const handleActivityJump = (event: ActivityEvent) => {
    if (!event.sourceId) return;
    if (event.kind === 'task_created' || event.kind === 'task_completed' || event.kind === 'task_failed') {
      setPendingTaskFocusId(event.sourceId);
      setDevToolsTab('task-runner');
    } else if (event.kind === 'goal_signal') {
      setPendingGoalSpotlightId(event.sourceId);
      setDevToolsTab('goals');
    } else if (event.kind === 'scan_run') {
      setDevToolsTab('idea-scanner');
    }
  };

  // Persisted tile order per project — different projects often care about
  // different metrics first (a hot-bug project wants `unresolved` first; a
  // PR-heavy project wants `open_prs` first). Drag a tile to reorder; the
  // order is keyed by activeProjectId so each project remembers its layout.
  const [tileOrder, setTileOrder] = useState<TileId[]>(DEFAULT_TILE_ORDER);
  useEffect(() => {
    if (!activeProjectId) return;
    setTileOrder(readTileOrder(activeProjectId));
  }, [activeProjectId]);
  const [draggingTileId, setDraggingTileId] = useState<TileId | null>(null);
  const handleTileDrop = (target: TileId) => {
    if (!draggingTileId || draggingTileId === target || !activeProjectId) return;
    const next = [...tileOrder];
    const from = next.indexOf(draggingTileId);
    const to = next.indexOf(target);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, draggingTileId);
    setTileOrder(next);
    writeTileOrder(activeProjectId, next);
  };

  if (!activeProjectId || !activeProject) {
    return (
      <ContentBox>
        <ContentHeader
          icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
          iconColor="primary"
          title={po.codebase}
          subtitle="—"
          actions={<LifecycleProjectPicker />}
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

  // Vital-signs tinting — threshold-derived. Status-token colours answer
  // "is this number good or bad?" rather than "what's its semantic role?"
  const issueTone = !repoStats || repoStats.openIssues === 0 ? 'neutral' : repoStats.openIssues > 50 ? 'error' : 'warning';
  const prTone = !repoStats || repoStats.openPullRequests === 0 ? 'neutral' : 'info';
  const commitsTone = !repoStats || repoStats.commitsLastWeek === 0 ? 'warning' : 'success';
  const unresolvedTone = !monitorStats || monitorStats.unresolvedIssues === 0 ? 'success' : monitorStats.unresolvedIssues > 5 ? 'error' : 'warning';
  const events24Tone = !monitorStats || monitorStats.eventsLast24h === 0 ? 'success' : monitorStats.eventsLast24h > 100 ? 'error' : 'warning';
  const events7Tone = !monitorStats || monitorStats.eventsLastWeek === 0 ? 'success' : 'info';

  const repoLinked = repoState === 'connected' && repoStats !== null;
  const monitorLinked = monitorState === 'connected' && monitorStats !== null;

  // Overall pulse signal — escalates to the worst observed tone.
  const overallTone =
    (issueTone === 'error' || unresolvedTone === 'error' || events24Tone === 'error') ? 'error' :
      (issueTone === 'warning' || commitsTone === 'warning' || unresolvedTone === 'warning' || events24Tone === 'warning') ? 'warning' :
        (repoLinked && monitorLinked) ? 'success' : 'neutral';

  const monitoringCred = activeProject.monitoring_credential_id
    ? credentials.find((c) => c.id === activeProject.monitoring_credential_id) ?? null
    : null;

  // Vital tiles double as jump-offs to their source: repo tiles deep-link to
  // the connected GitHub/GitLab subpage (or route to setup when unlinked), and
  // monitoring tiles reveal the Sentry connection chain inline.
  const repoTileIds: TileId[] = ['open_issues', 'open_prs', 'commits'];
  const isRepoTile = (id: TileId) => repoTileIds.includes(id);
  const handleTileActivate = (id: TileId) => {
    if (isRepoTile(id)) {
      if (repoLinked && activeProject.github_url) {
        const sub = id === 'open_issues'
          ? (isGitLab ? '/-/issues' : '/issues')
          : id === 'open_prs'
            ? (isGitLab ? '/-/merge_requests' : '/pulls')
            : (isGitLab ? '/-/commits' : '/commits');
        const safe = sanitizeExternalUrl(activeProject.github_url.replace(/\/+$/, '') + sub);
        if (safe) void openExternal(safe).catch(silentCatch('ProjectOverviewPage:openRepoTile'));
      } else if (repoState === 'empty') {
        setSidebarSection('credentials');
      } else {
        setDevToolsTab('projects');
      }
      return;
    }
    // Monitoring tiles — reveal the Sentry chain, or route to credentials setup.
    if (monitorState === 'empty') setSidebarSection('credentials');
    else setShowMonitorChain(true);
  };
  const tileActionLabel = (id: TileId): string => {
    if (isRepoTile(id)) return repoLinked && activeProject.github_url ? po.vital_jump_repo : po.vital_jump_setup;
    return monitorState === 'empty' ? po.vital_jump_setup : po.vital_jump_monitor;
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={
          <div className="relative">
            <LayoutDashboard className="w-5 h-5 text-primary" />
            <PulseDot tone={overallTone} />
          </div>
        }
        iconColor="primary"
        title={activeProject.name}
        subtitle={activeProject.root_path}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        {/* ==================== Pipeline (read-only) ==================== */}
        <section className="mb-6">
          <h2 className="typo-label text-foreground mb-3">{po.pipeline_heading}</h2>
          <div className="rounded-card border border-primary/10 bg-card/20 p-4">
            <ProjectPipelineView
              name={activeProject.name}
              path={activeProject.root_path}
              sourceMode={activeProject.team_id ? 'team' : 'standalone'}
              teamName={activeProject.team_id ? (teams.find((tm) => tm.id === activeProject.team_id)?.name ?? null) : null}
              connectorName={activeProject.pr_credential_id ? (credentials.find((c) => c.id === activeProject.pr_credential_id)?.name ?? null) : null}
              githubUrl={activeProject.github_url ?? undefined}
              mainBranch={activeProject.main_branch ?? undefined}
              testEnvUrl={activeProject.test_env_url ?? undefined}
              testEnvBranch={activeProject.test_env_branch ?? undefined}
              standardsConfig={activeProject.standards_config ?? undefined}
            />
          </div>
          <StandardsScanCard projectId={activeProjectId} />
        </section>

        {/* ==================== Vital signs strip ==================== */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="typo-label text-foreground"><DebtText k="auto_vital_signs_5bf24670" /></h2>
            <div className="flex items-center gap-2">
              {lastLoadedAt && (
                <span className="typo-caption text-foreground">
                  {po.vital_updated_label}{' '}
                  <RelativeTime timestamp={lastLoadedAt} className="tabular-nums" />
                </span>
              )}
              <button
                type="button"
                onClick={() => refresh()}
                title={t.common.refresh}
                aria-label={t.common.refresh}
                className="p-1 rounded-interactive hover:bg-primary/10 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-foreground ${statsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {(() => {
              const tilesById: Record<TileId, { icon: typeof CircleDot; value: string | number; label: string; tone: Tone; loading: boolean }> = {
                open_issues: { icon: CircleDot, value: repoStats?.openIssues ?? '—', label: po.open_issues, tone: issueTone, loading: repoState === 'loading' },
                open_prs:    { icon: GitPullRequest, value: repoStats?.openPullRequests ?? '—', label: isGitLab ? po.open_mrs : po.open_prs, tone: prTone, loading: repoState === 'loading' },
                commits:     { icon: GitCommitHorizontal, value: repoStats?.commitsLastWeek ?? '—', label: po.commits_this_week, tone: commitsTone, loading: repoState === 'loading' },
                unresolved:  { icon: Bug, value: monitorStats?.unresolvedIssues ?? '—', label: po.unresolved_issues, tone: unresolvedTone, loading: monitorState === 'loading' },
                events_24h:  { icon: Activity, value: monitorStats?.eventsLast24h ?? '—', label: po.events_24h, tone: events24Tone, loading: monitorState === 'loading' },
                events_7d:   { icon: BarChart3, value: monitorStats?.eventsLastWeek ?? '—', label: po.events_7d, tone: events7Tone, loading: monitorState === 'loading' },
              };
              return tileOrder.map((id) => {
                const t = tilesById[id];
                return (
                  <VitalTile
                    key={id}
                    icon={t.icon}
                    value={t.value}
                    label={t.label}
                    tone={t.tone}
                    loading={t.loading}
                    draggable
                    isDragging={draggingTileId === id}
                    onDragStart={() => setDraggingTileId(id)}
                    onDragEnd={() => setDraggingTileId(null)}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); handleTileDrop(id); }}
                    onActivate={() => handleTileActivate(id)}
                    actionLabel={tileActionLabel(id)}
                  />
                );
              });
            })()}
          </div>
        </section>

        {/* ==================== "Today" cross-tab activity ==================== */}
        {todayActivity.length > 0 && (
          <section className="mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="typo-label text-foreground">{po.today_activity_heading}</h2>
              <span className="typo-caption text-foreground tabular-nums">{todayActivity.length}</span>
            </div>
            <ul className="rounded-card border border-primary/10 bg-card/30 divide-y divide-primary/5 max-h-72 overflow-y-auto">
              {todayActivity.map((event) => (
                <ActivityRow key={event.id} event={event} onJump={handleActivityJump} />
              ))}
            </ul>
          </section>
        )}

        {/* ==================== Connections rail ==================== */}
        <section>
          <h2 className="typo-label text-foreground mb-3">CONNECTIONS</h2>
          <div className="rounded-card border border-primary/10 bg-card/30 divide-y divide-primary/5">
            {/* --- Codebase row --- */}
            <ConnectionRow
              icon={Code2}
              brandColor="text-foreground"
              title={isGitLab ? 'GitLab' : 'GitHub'}
              status={repoState}
              statusError={repoError}
              meta={
                repoStats ? (
                  <>
                    <MetaPill icon={GitBranch} text={repoStats.defaultBranch} />
                    {repoStats.lastPushAt && (
                      <MetaPill text={`pushed ${relativeTime(repoStats.lastPushAt)}`} />
                    )}
                    {activeRepoCredId && credentials.find((c) => c.id === activeRepoCredId) && (
                      <MetaPill icon={Key} text={credentials.find((c) => c.id === activeRepoCredId)!.name} dim />
                    )}
                  </>
                ) : repoState === 'unmapped' && repoCreds.length > 0 ? (
                  <MetaPill icon={Key} text={`${repoCreds.length} credential(s) found — needs repo URL`} tone="warning" />
                ) : repoState === 'empty' ? (
                  <MetaPill text="No GitHub/GitLab credential" tone="neutral" />
                ) : null
              }
              actions={
                <div className="flex items-center gap-1">
                  {(repoState === 'unmapped' || repoState === 'empty') && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => repoState === 'empty' ? setSidebarSection('credentials') : setDevToolsTab('projects')}
                    >
                      {repoState === 'empty' ? po.go_to_connections : po.go_to_projects}
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowRepoChain((v) => !v)}
                    className="p-1 rounded-interactive hover:bg-primary/10 transition-colors"
                    title={debtText("auto_show_connection_chain_c0a20250")}
                  >
                    <Settings className="w-3.5 h-3.5 text-foreground" />
                  </button>
                </div>
              }
            />
            {showRepoChain && (
              <div className="px-4 py-3 bg-primary/[0.03]">
                {(repoState === 'connected' || repoState === 'error' || repoState === 'unmapped') ? (
                  <ConnectorChain
                    projectName={activeProject.name}
                    url={activeProject.github_url ?? null}
                    credentials={repoCreds}
                    activeCredId={activeRepoCredId}
                    onPickCred={(id) => { setActiveRepoCredId(id); }}
                    onEditUrl={() => setDevToolsTab('projects')}
                  />
                ) : (
                  <p className="typo-caption text-foreground"><DebtText k="auto_set_a_repo_url_on_this_project_to_see_the__0fd8e832" /></p>
                )}
                {repoState === 'unmapped' && repoCreds.length > 0 && (
                  <p className="typo-caption text-foreground mt-2">{po.set_repo_url}</p>
                )}
                {repoState === 'error' && (
                  <Button variant="secondary" size="xs" className="mt-2" onClick={loadRepoStats}>{po.retry}</Button>
                )}
              </div>
            )}

            {/* --- Monitoring row --- */}
            <ConnectionRow
              icon={Shield}
              brandColor="text-red-400"
              title="Sentry"
              status={monitorState}
              statusError={monitorError}
              meta={
                monitorLinked ? (
                  <>
                    <MetaPill icon={Bug} text={`${monitorStats!.unresolvedIssues} unresolved`} tone={unresolvedTone} />
                    <MetaPill text={splitSentrySlug(activeProject.monitoring_project_slug)[1] ?? '-'} dim />
                    {monitoringCred && <MetaPill icon={Key} text={monitoringCred.name} dim />}
                  </>
                ) : monitorState === 'unmapped' ? (
                  <MetaPill text="needs project link" tone="warning" />
                ) : monitorState === 'empty' ? (
                  <MetaPill text="No Sentry credential" tone="neutral" />
                ) : null
              }
              actions={
                <div className="flex items-center gap-1">
                  {monitorState === 'empty' && (
                    <Button variant="ghost" size="xs" onClick={() => setSidebarSection('credentials')}>
                      {po.go_to_connections}
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowMonitorChain((v) => !v)}
                    className="p-1 rounded-interactive hover:bg-primary/10 transition-colors"
                    title={debtText("auto_show_connection_chain_c0a20250")}
                  >
                    <Settings className="w-3.5 h-3.5 text-foreground" />
                  </button>
                </div>
              }
            />
            {showMonitorChain && (
              <div className="px-4 py-3 bg-primary/[0.03]">
                {(monitorState === 'connected' || monitorState === 'error' || monitorState === 'unmapped') && (
                  <MonitoringChain
                    projectName={activeProject.name}
                    credential={monitoringCred}
                    slug={activeProject.monitoring_project_slug ?? null}
                  />
                )}
                {monitorState === 'unmapped' && (
                  <SentryProjectPicker
                    credentials={sentryCreds}
                    projectId={activeProject.id}
                    onLinked={() => {
                      refresh();
                      setTimeout(() => loadMonitorStats(), 500);
                    }}
                  />
                )}
                {monitorState === 'error' && (
                  <Button variant="secondary" size="xs" className="mt-2" onClick={loadMonitorStats}>{po.retry}</Button>
                )}
              </div>
            )}
          </div>
        </section>

        {(!repoLinked || !monitorLinked) && (
          <p className="typo-caption text-foreground mt-4 flex items-center gap-1.5">
            <ExternalLink className="w-3 h-3" />
            <DebtText k="auto_connect_more_sources_to_enrich_the_dashboa_10066c24" />
          </p>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const TONE_BG: Record<Tone, string> = {
  success: 'bg-status-success/10 border-status-success/25',
  warning: 'bg-status-warning/10 border-status-warning/25',
  error: 'bg-status-error/10 border-status-error/25',
  info: 'bg-status-info/10 border-status-info/25',
  neutral: 'bg-card/40 border-primary/10',
};
const TONE_TEXT: Record<Tone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
  neutral: 'text-foreground',
};

function VitalTile({
  icon: Icon, value, label, tone, loading,
  draggable, isDragging, onDragStart, onDragEnd, onDragOver, onDrop,
  onActivate, actionLabel,
}: {
  icon: typeof CircleDot;
  value: string | number;
  label: string;
  tone: Tone;
  loading?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  onActivate?: () => void;
  actionLabel?: string;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onActivate}
      onKeyDown={onActivate ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
      } : undefined}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      title={actionLabel}
      aria-label={onActivate && actionLabel ? `${label} — ${actionLabel}` : undefined}
      className={`rounded-card border ${TONE_BG[tone]} px-3 py-2.5 transition-all ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${onActivate ? 'hover:ring-1 hover:ring-primary/30 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40' : ''} ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${TONE_TEXT[tone]}`} />
        {loading && <RefreshCw className="w-3 h-3 animate-spin text-foreground" />}
      </div>
      <p className={`typo-data-lg leading-none ${TONE_TEXT[tone]}`}>{value}</p>
      <p className="typo-caption text-foreground truncate mt-1">{label}</p>
    </div>
  );
}

function PulseDot({ tone }: { tone: Tone }) {
  const colour = tone === 'success' ? 'bg-status-success' : tone === 'warning' ? 'bg-status-warning' : tone === 'error' ? 'bg-status-error' : 'bg-status-neutral';
  return (
    <span className="absolute -top-0.5 -right-0.5 flex w-2.5 h-2.5">
      <motion.span
        className={`absolute inline-flex h-full w-full rounded-full ${colour} opacity-75`}
        animate={{ scale: [1, 2, 1], opacity: [0.75, 0, 0.75] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
      />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colour}`} />
    </span>
  );
}

function ConnectionRow({
  icon: Icon, brandColor, title, status, statusError, meta, actions,
}: {
  icon: typeof Code2;
  brandColor: string;
  title: string;
  status: string;
  statusError: string | null;
  meta: React.ReactNode;
  actions: React.ReactNode;
}) {
  const statusIcon = status === 'connected' ? CheckCircle2
    : status === 'loading' ? RefreshCw
      : status === 'error' ? AlertCircle
        : Key;
  const statusTone = status === 'connected' ? 'text-status-success'
    : status === 'loading' ? 'text-foreground animate-spin'
      : status === 'error' ? 'text-status-error'
        : 'text-status-warning';
  const StatusIcon = statusIcon;
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <Icon className={`w-5 h-5 shrink-0 ${brandColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="typo-body font-medium text-foreground">{title}</span>
          <StatusIcon className={`w-3.5 h-3.5 ${statusTone}`} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {meta}
        </div>
        {status === 'error' && statusError && (
          <p className="typo-caption text-status-error/80 mt-1 break-words">{statusError}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

function MetaPill({
  icon: Icon, text, tone, dim,
}: {
  icon?: typeof Code2;
  text: string;
  tone?: Tone;
  dim?: boolean;
}) {
  const cls = tone
    ? `${TONE_BG[tone]} ${TONE_TEXT[tone]}`
    : dim
      ? 'border-primary/5 bg-card/40 text-foreground'
      : 'border-primary/10 bg-card/30 text-foreground';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border typo-caption ${cls}`}>
      {Icon && <Icon className="w-3 h-3" />}
      <span className="truncate max-w-[200px]">{text}</span>
    </span>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  return `${w}w ago`;
}

// ---------------------------------------------------------------------------
// ActivityRow — one entry in the "Today" cross-tab feed
// ---------------------------------------------------------------------------

const ACTIVITY_META: Record<ActivityKind, { icon: typeof CircleDot; tint: string }> = {
  scan_run:       { icon: ScanSearch,    tint: 'text-amber-400' },
  task_created:   { icon: Sparkles,      tint: 'text-blue-400' },
  task_completed: { icon: CheckCircle2,  tint: 'text-emerald-400' },
  task_failed:    { icon: XCircle,       tint: 'text-red-400' },
  goal_signal:    { icon: Target,        tint: 'text-violet-400' },
};

function ActivityRow({ event, onJump }: { event: ActivityEvent; onJump: (e: ActivityEvent) => void }) {
  const meta = ACTIVITY_META[event.kind];
  const Icon = meta.icon;
  const clickable = Boolean(event.sourceId) || event.kind === 'scan_run';
  const inner = (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.tint}`} />
      <span className="text-md text-foreground truncate flex-1">{event.label}</span>
      <span className="typo-caption text-foreground tabular-nums shrink-0">{relativeTime(event.timestamp)}</span>
    </div>
  );
  return (
    <li>
      {clickable ? (
        <button
          type="button"
          onClick={() => onJump(event)}
          className="w-full text-left hover:bg-primary/5 transition-colors"
        >
          {inner}
        </button>
      ) : (
        inner
      )}
    </li>
  );
}
