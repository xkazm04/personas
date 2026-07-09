/**
 * MonitoringSection — the "Monitoring" tab of the Observability module. Mirrors
 * the LLM tab's philosophy: a projects × monitoring-connector assignment matrix
 * (writes `dev_projects.monitoring_credential_id`) above a per-active-project
 * stats readout read live from the assigned tool (Sentry today) — unresolved
 * issues + events (24h / 7d) via the shared `fetchSentryStats` adapter.
 *
 * i18n NOTE: the monitoring-specific microcopy here is intentionally hardcoded
 * English pending an extraction pass (tracked follow-up). The stat labels reuse
 * the already-i18n'd `project_overview.*` keys.
 */
import { useCallback, type ReactNode } from 'react';
import { Shield, RefreshCw, Plug, AlertCircle, Bug, Activity, BarChart3 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { updateProject } from '@/api/devTools/devTools';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SentryProjectPicker } from '../sub_overview/OverviewParts';
import AssignmentMatrix from './AssignmentMatrix';
import { useMonitoringPinpoints } from './useMonitoringPinpoints';
import type { AssignmentMatrixProps } from './matrixShared';

const MON_LABELS = {
  coverage: 'projects monitored',
  gap: 'gap',
  notWired: '— not monitored —',
  wirePlaceholder: 'Wire a monitor…',
};

function MonMatrix() {
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const { monCreds } = useMonitoringPinpoints();

  const assign = useCallback(
    async (projectId: string, credId: string | null) => {
      try {
        await updateProject(projectId, { monitoringCredentialId: credId });
        await fetchProjects();
      } catch (e) {
        toastCatch('features/plugins/dev-tools/sub_llm_overview/monitoring-assign')(e);
      }
    },
    [fetchProjects],
  );

  if (projects.length === 0) return null;
  if (monCreds.length === 0) {
    return (
      <div className="mx-4 mt-3 rounded-card border border-primary/10 bg-secondary/40 px-4 py-3 flex items-center gap-2.5">
        <Plug className="w-4 h-4 text-primary/50 shrink-0" />
        <div className="text-[11px] text-foreground/60">
          No app-monitoring connector in your vault yet — add Sentry in Connections to map error tracking per project.
        </div>
      </div>
    );
  }

  const props: AssignmentMatrixProps = {
    projects,
    creds: monCreds,
    getCredId: (p) => p.monitoring_credential_id,
    assign,
    labels: MON_LABELS,
    testId: 'monitoring-overview-matrix',
    testIdPrefix: 'monitoring-assign',
  };
  return <AssignmentMatrix {...props} />;
}

function StateMessage({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 text-center px-6">
      <div className="text-primary/40">{icon}</div>
      <p className="typo-caption font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-foreground/50 max-w-sm">{subtitle}</p>
    </div>
  );
}

export default function MonitoringSection() {
  const { t } = useTranslation();
  const po = t.project_overview;
  const { activeProject, state, stats, error, cred, monCreds, reload } = useMonitoringPinpoints();

  return (
    <>
      <MonMatrix />
      <div className="flex-1 min-h-0 mx-4 my-3 flex flex-col rounded-card border border-primary/10 overflow-hidden">
        <div className="px-4 py-2 border-b border-primary/10 flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-red-400" />
          <span className="typo-caption text-foreground truncate">{activeProject?.name ?? '—'}</span>
          <button
            onClick={() => reload()}
            className="ml-auto p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/8 focus-ring"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {!activeProject ? (
          <StateMessage icon={<AlertCircle className="w-8 h-8" />} title="No project selected" subtitle="Pick a project to see its monitoring." />
        ) : state === 'empty' ? (
          <StateMessage icon={<Plug className="w-8 h-8" />} title="No monitoring connector" subtitle="Add a Sentry credential in Connections to map monitoring." />
        ) : state === 'unmapped' ? (
          cred && cred.serviceType.toLowerCase() === 'sentry' ? (
            <div className="p-4">
              <SentryProjectPicker
                credentials={monCreds.filter((c) => c.serviceType.toLowerCase() === 'sentry')}
                projectId={activeProject.id}
                onLinked={() => reload()}
              />
            </div>
          ) : (
            <StateMessage icon={<Plug className="w-8 h-8" />} title="Not linked" subtitle="Assign a monitoring connector to this project in the matrix above." />
          )
        ) : state === 'unsupported' ? (
          <StateMessage
            icon={<Bug className="w-8 h-8" />}
            title={`${cred?.serviceType ?? 'This tool'} isn't wired for stats yet`}
            subtitle="The assignment is saved; its live adapter is coming."
          />
        ) : state === 'loading' ? (
          <div className="flex-1 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : state === 'error' ? (
          <StateMessage icon={<AlertCircle className="w-8 h-8 text-red-400/70" />} title="Couldn't load monitoring" subtitle={error ?? 'Unknown error'} />
        ) : stats ? (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label={po.unresolved_issues} value={stats.unresolvedIssues} icon={Bug} tone={stats.unresolvedIssues === 0 ? 'success' : stats.unresolvedIssues > 5 ? 'danger' : 'warning'} />
            <StatCard label={po.events_24h} value={stats.eventsLast24h} icon={Activity} tone={stats.eventsLast24h === 0 ? 'success' : stats.eventsLast24h > 100 ? 'danger' : 'warning'} />
            <StatCard label={po.events_7d} value={stats.eventsLastWeek} icon={BarChart3} tone="info" />
          </div>
        ) : null}
      </div>
    </>
  );
}
