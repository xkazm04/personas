import {
  GitBranch, RefreshCw,
  CircleDot, GitPullRequest, GitCommitHorizontal, Shield,
  Bug, Activity, BarChart3, Link2,
  ExternalLink, LayoutDashboard,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { splitSentrySlug } from './adapters';
import {
  ConnectionCard, ConnectorChain, MonitoringChain, SentryProjectPicker, StatCard,
} from './OverviewParts';
import { isGitLabCred, type OverviewData } from './useOverviewData';

/**
 * Baseline Overview — current production layout. Two-column split with
 * Codebase (left) + Monitoring (right). Each column shows the connection
 * chain on top and a 4-tile stats grid below. Used as the A/B reference for
 * the prototype variants.
 */
export function ProjectOverviewBaseline({ data }: { data: OverviewData }) {
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

  return (
    <ContentBox>
      <ContentHeader
        icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={activeProject.name}
        subtitle={activeProject.root_path}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        <ActionRow>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={refresh}
          >
            {po.retry}
          </Button>
        </ActionRow>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-blue-400" />
              <h2 className="typo-section-title">{po.codebase}</h2>
            </div>

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
                  <StatCard icon={CircleDot} value={repoStats.openIssues} label={po.open_issues} color="amber" />
                  <StatCard icon={GitPullRequest} value={repoStats.openPullRequests} label={isGitLab ? po.open_mrs : po.open_prs} color="blue" />
                  <StatCard icon={GitCommitHorizontal} value={repoStats.commitsLastWeek} label={po.commits_this_week} color="violet" />
                  <StatCard icon={GitBranch} value={repoStats.defaultBranch} label={po.default_branch} color="emerald" />
                </div>
                {repoStats.lastPushAt && (
                  <p className="typo-caption text-foreground mt-2">
                    {po.last_push}: {new Date(repoStats.lastPushAt).toLocaleDateString()}
                  </p>
                )}
              </ConnectionCard>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-red-400" />
              <h2 className="typo-section-title">{po.monitoring}</h2>
            </div>

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
              <ConnectionCard title={po.monitoring} state="unmapped" serviceName="Sentry">
                <SentryProjectPicker
                  credentials={sentryCreds}
                  projectId={activeProject.id}
                  onLinked={() => {
                    refresh();
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
              <ConnectionCard title={po.monitoring} state="connected" serviceName="Sentry">
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={Bug} value={monitorStats.unresolvedIssues} label={po.unresolved_issues} color="red" />
                  <StatCard icon={Activity} value={monitorStats.eventsLast24h} label={po.events_24h} color="amber" />
                  <StatCard icon={BarChart3} value={monitorStats.eventsLastWeek} label={po.events_7d} color="blue" />
                  <StatCard icon={Link2} value={splitSentrySlug(activeProject.monitoring_project_slug)[1] ?? '-'} label={po.project_slug} color="violet" />
                </div>
              </ConnectionCard>
            )}
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
