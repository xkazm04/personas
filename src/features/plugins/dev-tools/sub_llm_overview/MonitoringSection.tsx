/**
 * MonitoringSection — the "Monitoring" tab of the Observability module. Mirrors
 * the LLM tab's philosophy: a projects × monitoring-connector assignment matrix
 * (writes `dev_projects.monitoring_credential_id`) above a per-active-project
 * stats readout read live from the assigned tool (Sentry today) — unresolved
 * issues + events (24h / 7d) via the shared `fetchSentryStats` adapter.
 *
 * i18n: the monitoring-specific microcopy resolves from `plugins.dev_tools.mon_*`
 * keys; the stat labels reuse the already-i18n'd `project_overview.*` keys.
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

// monCreds comes from the parent's single useMonitoringPinpoints instance —
// calling the hook here too ran the whole load() chain (vault listCredentials
// + fetchSentryOrgs + fetchSentryStats) TWICE per tab open, and the header's
// reload button only refreshed the parent copy.
function MonMatrix({ monCreds }: { monCreds: ReturnType<typeof useMonitoringPinpoints>['monCreds'] }) {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

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
        <div className="text-[11px] text-foreground/60">{dt.mon_no_cred}</div>
      </div>
    );
  }

  const props: AssignmentMatrixProps = {
    projects,
    creds: monCreds,
    getCredId: (p) => p.monitoring_credential_id,
    assign,
    labels: {
      coverage: dt.mon_coverage,
      gap: dt.mon_gap,
      notWired: dt.mon_not_wired,
      wirePlaceholder: dt.mon_wire_placeholder,
    },
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
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const po = t.project_overview;
  const { activeProject, state, stats, error, cred, monCreds, reload } = useMonitoringPinpoints();

  return (
    <>
      <MonMatrix monCreds={monCreds} />
      <div className="flex-1 min-h-0 mx-4 my-3 flex flex-col rounded-card border border-primary/10 overflow-hidden">
        <div className="px-4 py-2 border-b border-primary/10 flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-red-400" />
          <span className="typo-caption text-foreground truncate">{activeProject?.name ?? '—'}</span>
          <button
            onClick={() => reload()}
            className="ml-auto p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/8 focus-ring"
            title={dt.mon_refresh}
            aria-label={dt.mon_refresh}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {!activeProject ? (
          <StateMessage icon={<AlertCircle className="w-8 h-8" />} title={dt.mon_no_project_title} subtitle={dt.mon_no_project_sub} />
        ) : state === 'empty' ? (
          <StateMessage icon={<Plug className="w-8 h-8" />} title={dt.mon_empty_title} subtitle={dt.mon_empty_sub} />
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
            <StateMessage icon={<Plug className="w-8 h-8" />} title={dt.mon_unmapped_title} subtitle={dt.mon_unmapped_sub} />
          )
        ) : state === 'unsupported' ? (
          <StateMessage
            icon={<Bug className="w-8 h-8" />}
            title={tx(dt.mon_unsupported_title, { tool: cred?.serviceType ?? dt.llm_this_tool })}
            subtitle={dt.mon_unsupported_sub}
          />
        ) : state === 'loading' ? (
          <div className="flex-1 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : state === 'error' ? (
          <StateMessage icon={<AlertCircle className="w-8 h-8 text-red-400/70" />} title={dt.mon_error_title} subtitle={error ?? dt.mon_unknown_error} />
        ) : stats ? (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label={po.unresolved_issues} value={stats.unresolvedIssues ?? '—'} icon={Bug} tone={stats.unresolvedIssues === null ? 'warning' : stats.unresolvedIssues === 0 ? 'success' : stats.unresolvedIssues > 5 ? 'danger' : 'warning'} />
            <StatCard label={po.events_24h} value={stats.eventsLast24h} icon={Activity} tone={stats.eventsLast24h === 0 ? 'success' : stats.eventsLast24h > 100 ? 'danger' : 'warning'} />
            <StatCard label={po.events_7d} value={stats.eventsLastWeek} icon={BarChart3} tone="info" />
          </div>
        ) : null}
      </div>
    </>
  );
}
