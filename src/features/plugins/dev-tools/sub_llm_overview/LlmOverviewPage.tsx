/**
 * LLM Overview — Dev Tools content module.
 *
 * Two layers, per the feature spec:
 *  - Layer 1: a projects × LLM-observability-connector assignment matrix (writes
 *    `dev_projects.llm_tracking_credential_id`).
 *  - Layer 2: for the active project, a table of "LLM pinpoints" (use-case rollups)
 *    read live from the assigned tool through the shared `llmTracingAdapters`
 *    wrapper, over a rolling 24h/7d/30d window.
 *
 * All user-facing copy is i18n'd via `t.plugins.dev_tools.llm_*`.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, RefreshCw, AlertCircle, Plug, Clock, Layers } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { updateProject } from '@/api/devTools/devTools';
import { listUseCases } from '@/api/devTools/useCases';
import { slugifyUseCase } from '@/lib/useCaseSlug';
import { silentCatch } from '@/lib/silentCatch';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { useLlmPinpoints } from './useLlmPinpoints';
import type { LlmPinpoint, LlmWindow } from './llmTracingAdapters';
import type { AssignmentMatrixProps } from './matrixShared';
import AssignmentMatrix from './AssignmentMatrix';
import MonitoringSection from './MonitoringSection';

type ObsTab = 'llm' | 'monitoring';
const OBS_TABS: SegmentedTab<ObsTab>[] = [
  { id: 'llm', label: 'LLM' },
  { id: 'monitoring', label: 'Monitoring' },
];

const WINDOW_TABS: SegmentedTab<LlmWindow>[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];

// ---------------------------------------------------------------------------
// Layer 1 — projects × connector assignment matrix
// ---------------------------------------------------------------------------

function LlmMatrix() {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const { llmCreds } = useLlmPinpoints();

  const assign = useCallback(
    async (projectId: string, credId: string | null) => {
      try {
        await updateProject(projectId, { llmTrackingCredentialId: credId });
        await fetchProjects();
      } catch (e) {
        toastCatch('features/plugins/dev-tools/sub_llm_overview/assign')(e);
      }
    },
    [fetchProjects],
  );

  if (projects.length === 0) return null;

  if (llmCreds.length === 0) {
    return (
      <div className="mx-4 mt-3 rounded-card border border-primary/10 bg-secondary/40 px-4 py-3 flex items-center gap-2.5">
        <Plug className="w-4 h-4 text-primary/50 shrink-0" />
        <div className="text-[11px] text-foreground/60">{t.plugins.dev_tools.llm_no_cred}</div>
      </div>
    );
  }

  const props: AssignmentMatrixProps = {
    projects,
    creds: llmCreds,
    getCredId: (p) => p.llm_tracking_credential_id,
    assign,
    labels: {
      coverage: t.plugins.dev_tools.llm_projects_instrumented,
      gap: t.plugins.dev_tools.llm_gap,
      notWired: t.plugins.dev_tools.llm_not_wired,
      wirePlaceholder: t.plugins.dev_tools.llm_wire_placeholder,
    },
    testId: 'llm-overview-matrix',
    testIdPrefix: 'llm-overview-assign',
  };
  return <AssignmentMatrix {...props} />;
}

// ---------------------------------------------------------------------------
// Layer 2 — pinpoints table
// ---------------------------------------------------------------------------

function StateMessage({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 text-center px-6">
      <div className="text-primary/40">{icon}</div>
      <p className="typo-caption font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-foreground/50 max-w-sm">{subtitle}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LlmOverviewPage() {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const data = useLlmPinpoints();
  const { activeProject, state, pinpoints, error, cred, timeWindow, setTimeWindow, reload } = data;
  const [obsTab, setObsTab] = useState<ObsTab>('llm');

  // The declared use-case vocabulary for this project. `dev_use_cases.slug` is
  // the join key an observed call-site name normalizes to, so an instrumented
  // call site either maps to a use case the project has named, or it doesn't —
  // and that gap is worth seeing.
  const [useCaseSlugs, setUseCaseSlugs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!activeProject) {
      setUseCaseSlugs(new Map());
      return;
    }
    let cancelled = false;
    void listUseCases(activeProject.id, 'active')
      .then((rows) => {
        if (!cancelled) setUseCaseSlugs(new Map(rows.map((u) => [u.slug, u.name])));
      })
      .catch(silentCatch('LlmOverviewPage:listUseCases'));
    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  const matchUseCase = useCallback(
    (name: string | null): string | null =>
      name ? (useCaseSlugs.get(slugifyUseCase(name)) ?? null) : null,
    [useCaseSlugs],
  );

  const mappedCount = useMemo(
    () => pinpoints.filter((p) => matchUseCase(p.useCaseName) !== null).length,
    [pinpoints, matchUseCase],
  );

  const columns = useMemo<TableColumn<LlmPinpoint>[]>(
    () => [
      {
        key: 'useCaseName',
        label: dt.llm_col_usecase,
        width: 'minmax(160px, 1.6fr)',
        sortable: true,
        render: (r) => {
          const matched = matchUseCase(r.useCaseName);
          if (!r.useCaseName) {
            return <span className="text-foreground/40 italic">{dt.llm_unnamed}</span>;
          }
          return (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-foreground truncate">{r.useCaseName}</span>
              {matched && (
                <Layers
                  className="w-3 h-3 shrink-0 text-sky-400/80"
                  aria-label={tx(dt.llm_usecase_linked, { name: matched })}
                />
              )}
            </span>
          );
        },
      },
      {
        key: 'provider',
        label: dt.llm_col_provider,
        width: 'minmax(90px, 0.8fr)',
        sortable: true,
        render: (r) => <span className="text-foreground/80">{r.provider}</span>,
      },
      {
        key: 'model',
        label: dt.llm_col_model,
        width: 'minmax(140px, 1.2fr)',
        sortable: true,
        render: (r) => <span className="text-foreground/80 truncate">{r.model}</span>,
      },
      {
        key: 'calls',
        label: dt.llm_col_calls,
        width: '90px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => a.calls - b.calls,
        render: (r) => <Numeric value={r.calls} />,
      },
      {
        key: 'tokens',
        label: dt.llm_col_tokens,
        width: '110px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => a.inputTokens + a.outputTokens - (b.inputTokens + b.outputTokens),
        render: (r) => <Numeric value={r.inputTokens + r.outputTokens} />,
      },
      {
        key: 'cost',
        label: dt.llm_col_cost,
        width: '96px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => a.totalCostUsd - b.totalCostUsd,
        render: (r) => (
          <span className="text-foreground/80">
            ${' '}
            <Numeric value={r.totalCostUsd} precision={r.totalCostUsd >= 1 ? 2 : 4} />
          </span>
        ),
      },
    ],
    [dt, tx, matchUseCase],
  );

  return (
    <ContentBox data-testid="llm-overview-page">
      <ContentHeader
        icon={<BarChart3 className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={dt.llm_title}
        fitWidth
        actions={
          <>
            <SegmentedTabs
              tabs={OBS_TABS}
              activeTab={obsTab}
              onTabChange={setObsTab}
              variant="segment"
              size="sm"
              fullWidth={false}
              ariaLabel="Observability view"
            />
            {obsTab === 'llm' && (
              <>
                <SegmentedTabs
                  tabs={WINDOW_TABS}
                  activeTab={timeWindow}
                  onTabChange={setTimeWindow}
                  variant="segment"
                  size="sm"
                  fullWidth={false}
                  ariaLabel={dt.llm_aria_window}
                />
                <button
                  onClick={reload}
                  className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/8 focus-ring"
                  title={dt.llm_refresh}
                  aria-label={dt.llm_refresh}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </>
        }
      />

      {obsTab === 'monitoring' ? (
        <MonitoringSection />
      ) : (
        <>
      {/* Layer 1 — assignment matrix */}
      <LlmMatrix />

      {/* Layer 2 — pinpoints for the active project */}
      <div className="flex-1 min-h-0 mx-4 my-3 flex flex-col rounded-card border border-primary/10 overflow-hidden">
        {!activeProject ? (
          <StateMessage
            icon={<AlertCircle className="w-8 h-8" />}
            title={dt.llm_no_project_title}
            subtitle={dt.llm_no_project_sub}
          />
        ) : state === 'empty' ? (
          <StateMessage icon={<Plug className="w-8 h-8" />} title={dt.llm_empty_title} subtitle={dt.llm_empty_sub} />
        ) : state === 'unmapped' ? (
          <StateMessage
            icon={<Plug className="w-8 h-8" />}
            title={dt.llm_unmapped_title}
            subtitle={dt.llm_unmapped_sub}
          />
        ) : state === 'unsupported' ? (
          <StateMessage
            icon={<Clock className="w-8 h-8" />}
            title={tx(dt.llm_unsupported_title, { tool: cred?.serviceType ?? dt.llm_this_tool })}
            subtitle={dt.llm_unsupported_sub}
          />
        ) : state === 'loading' ? (
          <div className="flex-1 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : state === 'error' ? (
          <StateMessage
            icon={<AlertCircle className="w-8 h-8 text-red-400/70" />}
            title={dt.llm_error_title}
            subtitle={error ?? dt.llm_unknown_error}
          />
        ) : pinpoints.length === 0 ? (
          <StateMessage
            icon={<BarChart3 className="w-8 h-8" />}
            title={dt.llm_empty_calls_title}
            subtitle={tx(dt.llm_empty_calls_sub, {
              name: cred?.name ?? dt.llm_the_connector,
              window: timeWindow,
            })}
          />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <UnifiedTable
              columns={columns}
              data={pinpoints}
              getRowKey={(r) => `${r.useCaseName ?? '∅'}|${r.provider}|${r.model}`}
              rowHeight={40}
              density="compact"
              borderless
              defaultSortKey="cost"
              defaultSortDir="desc"
              ariaLabel={dt.llm_aria_table}
              tableId="llm-overview-pinpoints"
            />
            <div className="px-4 py-1.5 border-t border-primary/10 text-[10px] text-foreground/40 flex items-center justify-between gap-3">
              <span>{tx(dt.llm_cost_note, { tool: cred?.serviceType ?? dt.llm_this_tool })}</span>
              {useCaseSlugs.size > 0 && (
                <span className="flex items-center gap-1 shrink-0">
                  <Layers className="w-3 h-3 text-sky-400/80" />
                  {tx(dt.llm_usecase_coverage, { mapped: mappedCount, total: pinpoints.length })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </ContentBox>
  );
}
