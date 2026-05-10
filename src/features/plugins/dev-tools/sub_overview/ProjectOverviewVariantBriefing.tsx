import { useState } from 'react';
import {
  GitBranch, RefreshCw, Sparkles,
  Bug, Activity,
  Shield, ChevronRight, ExternalLink, LayoutDashboard,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { splitSentrySlug } from './adapters';
import {
  ConnectorChain, MonitoringChain, SentryProjectPicker,
} from './OverviewParts';
import { type OverviewData } from './useOverviewData';

/**
 * VARIANT — "Briefing": narrative report-card layout.
 *
 * Mental model: a daily memo / morning briefing. The user reads the
 * project's state in plain language first, then drills into numbers if
 * curious.
 *
 * Layout:
 *   - Hero band: oversized project name + path + a one-line "executive
 *     summary" generated from the data ("3 open PRs, last push 2 days ago,
 *     1 unresolved error fired in the last 24h").
 *   - Two stacked report cards (Codebase / Monitoring), full-width.
 *   - Each card opens with a plain-language headline, then a quiet inline
 *     metric strip (no tile chrome, no gradients), then a tiny "details"
 *     drawer for the connection chain.
 *   - No SVG decoration, no animation beyond mount fade-in. Generous
 *     whitespace, typography-driven. Mood: a printed memo.
 *
 * Differs from baseline:
 *   - Sentence-first, numbers-second. Baseline is grid-of-tiles immediately;
 *     this surfaces meaning before measurement.
 *   - Single column instead of side-by-side. Lets each section breathe and
 *     stops the user from comparing the two as if they were peers when one
 *     might be empty/unmapped.
 *   - Connection chain demoted to a footer drawer per card.
 */
export function ProjectOverviewVariantBriefing({ data }: { data: OverviewData }) {
  const { t } = useTranslation();
  const po = t.project_overview;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  const {
    activeProjectId, activeProject, credentials, repoCreds, sentryCreds,
    repoState, repoProvider, repoStats, repoError,
    activeRepoCredId, setActiveRepoCredId,
    monitorState, monitorStats, monitorError,
    loadRepoStats, loadMonitorStats, refresh,
  } = data;

  const [showRepoChain, setShowRepoChain] = useState(false);
  const [showMonitorChain, setShowMonitorChain] = useState(false);

  if (!activeProjectId || !activeProject) {
    return (
      <ContentBox>
        <ContentHeader
          icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
          iconColor="primary"
          title={po.codebase}
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

  // Plain-language summaries — assembled from whatever data we have. The
  // baseline only shows numbers; here we make the page narrate itself.
  const repoSummary = buildRepoSummary({ state: repoState, stats: repoStats, isGitLab, hasRepo: Boolean(activeProject.github_url), credCount: repoCreds.length });
  const monitorSummary = buildMonitorSummary({ state: monitorState, stats: monitorStats, hasLink: Boolean(activeProject.monitoring_credential_id && activeProject.monitoring_project_slug), credCount: sentryCreds.length });

  // Executive summary line — comma-joined micro-headlines.
  const headline = [repoSummary.headline, monitorSummary.headline].filter(Boolean).join(' · ');

  const monitoringCred = activeProject.monitoring_credential_id
    ? credentials.find((c) => c.id === activeProject.monitoring_credential_id) ?? null
    : null;

  return (
    <ContentBox>
      <ContentHeader
        icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={activeProject.name}
        subtitle={activeProject.root_path}
        actions={
          <div className="flex items-center gap-2">
            <LifecycleProjectPicker />
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={refresh}
            >
              {po.retry}
            </Button>
          </div>
        }
      />

      <ContentBody centered>
        {/* ==================== Hero / executive summary ==================== */}
        <section className="mb-8 max-w-3xl">
          <p className="typo-label text-foreground/60 mb-2 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            TODAY&apos;S BRIEFING
          </p>
          <p className="typo-body-lg text-foreground leading-relaxed">
            {headline || 'No connected sources yet — link a repository or monitoring service to populate this briefing.'}
          </p>
        </section>

        {/* ==================== Codebase report card ==================== */}
        <ReportCard
          icon={GitBranch}
          accent="text-blue-400"
          title={po.codebase}
          subtitle={isGitLab ? 'GitLab repository' : 'GitHub repository'}
          headline={repoSummary.body}
          state={repoState}
          stateError={repoError}
          metrics={repoStats ? [
            { label: po.open_issues, value: repoStats.openIssues },
            { label: isGitLab ? po.open_mrs : po.open_prs, value: repoStats.openPullRequests },
            { label: po.commits_this_week, value: repoStats.commitsLastWeek },
            { label: po.default_branch, value: repoStats.defaultBranch },
          ] : []}
          actions={(repoState === 'unmapped' || repoState === 'empty') ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<ExternalLink className="w-3 h-3" />}
              onClick={() => repoState === 'empty' ? setSidebarSection('credentials') : setDevToolsTab('projects')}
            >
              {repoState === 'empty' ? po.go_to_connections : po.go_to_projects}
            </Button>
          ) : repoState === 'error' ? (
            <Button variant="ghost" size="sm" onClick={loadRepoStats}>{po.retry}</Button>
          ) : null}
          drawerOpen={showRepoChain}
          onToggleDrawer={() => setShowRepoChain((v) => !v)}
          drawer={
            (repoState === 'connected' || repoState === 'error' || repoState === 'unmapped') ? (
              <ConnectorChain
                projectName={activeProject.name}
                url={activeProject.github_url ?? null}
                credentials={repoCreds}
                activeCredId={activeRepoCredId}
                onPickCred={(id) => { setActiveRepoCredId(id); }}
                onEditUrl={() => setDevToolsTab('projects')}
              />
            ) : (
              <p className="typo-caption text-foreground/60">Add a repo URL on this project to see the connection chain.</p>
            )
          }
        />

        {/* ==================== Monitoring report card ==================== */}
        <ReportCard
          icon={Shield}
          accent="text-red-400"
          title={po.monitoring}
          subtitle="Sentry observability"
          headline={monitorSummary.body}
          state={monitorState}
          stateError={monitorError}
          metrics={monitorStats ? [
            { label: po.unresolved_issues, value: monitorStats.unresolvedIssues, icon: Bug },
            { label: po.events_24h, value: monitorStats.eventsLast24h, icon: Activity },
            { label: po.events_7d, value: monitorStats.eventsLastWeek },
            { label: po.project_slug, value: splitSentrySlug(activeProject.monitoring_project_slug)[1] ?? '—' },
          ] : []}
          actions={monitorState === 'empty' ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<ExternalLink className="w-3 h-3" />}
              onClick={() => setSidebarSection('credentials')}
            >
              {po.go_to_connections}
            </Button>
          ) : monitorState === 'error' ? (
            <Button variant="ghost" size="sm" onClick={loadMonitorStats}>{po.retry}</Button>
          ) : null}
          drawerOpen={showMonitorChain}
          onToggleDrawer={() => setShowMonitorChain((v) => !v)}
          drawer={
            <>
              {(monitorState === 'connected' || monitorState === 'error' || monitorState === 'unmapped') && (
                <MonitoringChain
                  projectName={activeProject.name}
                  credential={monitoringCred}
                  slug={activeProject.monitoring_project_slug ?? null}
                />
              )}
              {monitorState === 'unmapped' && (
                <div className="mt-3">
                  <SentryProjectPicker
                    credentials={sentryCreds}
                    projectId={activeProject.id}
                    onLinked={() => {
                      refresh();
                      setTimeout(() => loadMonitorStats(), 500);
                    }}
                  />
                </div>
              )}
            </>
          }
        />
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// Report card primitive — the central abstraction for this variant
// ---------------------------------------------------------------------------

interface MetricEntry {
  label: string;
  value: string | number;
  icon?: typeof Bug;
}

function ReportCard({
  icon: Icon, accent, title, subtitle, headline, state, stateError, metrics, actions, drawer, drawerOpen, onToggleDrawer,
}: {
  icon: typeof GitBranch;
  accent: string;
  title: string;
  subtitle: string;
  headline: string;
  state: string;
  stateError: string | null;
  metrics: MetricEntry[];
  actions: React.ReactNode;
  drawer: React.ReactNode;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  return (
    <article className="mb-6 max-w-3xl border-l-2 border-primary/15 pl-5 py-1">
      <header className="mb-3 flex items-baseline gap-3">
        <Icon className={`w-5 h-5 ${accent} relative top-1`} />
        <div className="flex-1 min-w-0">
          <h2 className="typo-section-title text-foreground">{title}</h2>
          <p className="typo-caption text-foreground/55">{subtitle}</p>
        </div>
        {actions}
      </header>

      <p className="typo-body text-foreground leading-relaxed mb-4 max-w-prose">
        {headline}
      </p>

      {state === 'error' && stateError && (
        <p className="typo-caption text-status-error/90 mb-3 break-words">{stateError}</p>
      )}

      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-3">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="typo-data-lg text-foreground tabular-nums leading-tight">{m.value}</span>
              <span className="typo-caption text-foreground/55 mt-0.5 flex items-center gap-1">
                {m.icon && <m.icon className="w-3 h-3" />}
                {m.label}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleDrawer}
        className="inline-flex items-center gap-1 typo-caption text-foreground/55 hover:text-foreground transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${drawerOpen ? 'rotate-90' : ''}`} />
        {drawerOpen ? 'Hide connection details' : 'Show connection details'}
      </button>

      {drawerOpen && (
        <div className="mt-3 pl-2 border-l border-primary/10">
          {drawer}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Plain-language summary builders
// ---------------------------------------------------------------------------

function buildRepoSummary({ state, stats, isGitLab, hasRepo, credCount }: {
  state: string;
  stats: { openIssues: number; openPullRequests: number; commitsLastWeek: number; lastPushAt: string | null } | null;
  isGitLab: boolean;
  hasRepo: boolean;
  credCount: number;
}): { headline: string; body: string } {
  if (state === 'loading') return { headline: '', body: 'Fetching repository stats…' };
  if (state === 'empty') return { headline: '', body: `No ${isGitLab ? 'GitLab' : 'GitHub'} credential is connected. Add one to populate this section.` };
  if (state === 'unmapped') return {
    headline: '',
    body: hasRepo
      ? 'Repository URL is set but no matching credential resolves it. Open the projects tab to fix the linkage.'
      : `${credCount} credential(s) are available — set the project's repository URL to start fetching stats.`,
  };
  if (state === 'error') return { headline: '', body: 'Could not reach the repository host. See the error message below.' };
  if (!stats) return { headline: '', body: '' };

  const lastPush = stats.lastPushAt ? relativeTime(stats.lastPushAt) : null;
  const headlineParts: string[] = [];
  if (stats.openIssues > 0) headlineParts.push(`${stats.openIssues} open issue${stats.openIssues === 1 ? '' : 's'}`);
  if (stats.openPullRequests > 0) headlineParts.push(`${stats.openPullRequests} open ${isGitLab ? 'MR' : 'PR'}${stats.openPullRequests === 1 ? '' : 's'}`);
  if (stats.commitsLastWeek > 0) headlineParts.push(`${stats.commitsLastWeek} commit${stats.commitsLastWeek === 1 ? '' : 's'} this week`);
  const headline = headlineParts.length > 0 ? headlineParts.join(', ') : 'no recent activity';

  const verb = stats.commitsLastWeek === 0 ? 'is quiet' : stats.commitsLastWeek > 20 ? 'is busy' : 'is active';
  const body = `The repo ${verb}${lastPush ? ` — last push ${lastPush}` : ''}. ${stats.openIssues > 0 ? `${stats.openIssues} ${stats.openIssues === 1 ? 'issue is' : 'issues are'} open.` : 'No open issues right now.'}`;

  return { headline, body };
}

function buildMonitorSummary({ state, stats, hasLink, credCount }: {
  state: string;
  stats: { unresolvedIssues: number; eventsLast24h: number; eventsLastWeek: number } | null;
  hasLink: boolean;
  credCount: number;
}): { headline: string; body: string } {
  if (state === 'loading') return { headline: '', body: 'Fetching observability stats…' };
  if (state === 'empty') return { headline: '', body: 'No Sentry credential is connected. Add one to surface error counts here.' };
  if (state === 'unmapped') return {
    headline: '',
    body: hasLink
      ? 'Sentry credential is linked but the project slug needs re-confirmation. Use the picker below to relink.'
      : `${credCount} Sentry credential(s) are available — link a project to start tracking issues.`,
  };
  if (state === 'error') return { headline: '', body: 'Could not reach Sentry. See the error message below.' };
  if (!stats) return { headline: '', body: '' };

  const headlineParts: string[] = [];
  if (stats.unresolvedIssues > 0) headlineParts.push(`${stats.unresolvedIssues} unresolved error${stats.unresolvedIssues === 1 ? '' : 's'}`);
  if (stats.eventsLast24h > 0) headlineParts.push(`${stats.eventsLast24h} event${stats.eventsLast24h === 1 ? '' : 's'} in 24h`);
  const headline = headlineParts.length > 0 ? headlineParts.join(', ') : 'no errors today';

  const tone = stats.unresolvedIssues === 0 && stats.eventsLast24h === 0
    ? 'Production looks calm — no events in the last 24 hours and no unresolved issues.'
    : stats.unresolvedIssues > 5
      ? `${stats.unresolvedIssues} issues need attention. ${stats.eventsLast24h} events fired in the last day, ${stats.eventsLastWeek} over the past week.`
      : `${stats.unresolvedIssues > 0 ? `${stats.unresolvedIssues} issue${stats.unresolvedIssues === 1 ? '' : 's'} unresolved.` : 'All known issues resolved.'} ${stats.eventsLast24h} event${stats.eventsLast24h === 1 ? '' : 's'} in the last 24 hours.`;
  return { headline, body: tone };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.round(d / 7);
  return `${w} week${w === 1 ? '' : 's'} ago`;
}
