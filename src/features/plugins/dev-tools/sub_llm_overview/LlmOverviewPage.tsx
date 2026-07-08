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
 * NOTE (Phase 2a): copy is intentionally in English pending the Phase-3 i18n pass
 * (this module's UI is slated for a `/prototype` visual iteration first — see the
 * feature plan). Layer 1 uses a plain control set for the same reason.
 */
import { useCallback, type ReactNode } from 'react';
import { BarChart3, RefreshCw, AlertCircle, Plug, Clock } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { updateProject } from '@/api/devTools/devTools';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { toastCatch } from '@/lib/silentCatch';
import { useLlmPinpoints } from './useLlmPinpoints';
import type { LlmPinpoint, LlmWindow } from './llmTracingAdapters';
import type { LlmOverviewMatrixProps } from './matrixShared';
import LlmOverviewMatrix from './LlmOverviewMatrix';

const WINDOW_TABS: SegmentedTab<LlmWindow>[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];

// ---------------------------------------------------------------------------
// Layer 1 — projects × connector assignment matrix
// ---------------------------------------------------------------------------

function AssignmentMatrix() {
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
        <div className="text-[11px] text-foreground/60">
          No Langfuse / LangSmith / Helicone / LightTrack credential in your vault yet. Add one under
          Vault → Connectors, then assign it here.
        </div>
      </div>
    );
  }

  const props: LlmOverviewMatrixProps = { projects, llmCreds, assign };
  return <LlmOverviewMatrix {...props} />;
}

// ---------------------------------------------------------------------------
// Layer 2 — pinpoints table
// ---------------------------------------------------------------------------

const COLUMNS: TableColumn<LlmPinpoint>[] = [
  {
    key: 'useCaseName',
    label: 'Use case',
    width: 'minmax(160px, 1.6fr)',
    sortable: true,
    render: (r) =>
      r.useCaseName ? (
        <span className="text-foreground truncate">{r.useCaseName}</span>
      ) : (
        <span className="text-foreground/40 italic">unnamed</span>
      ),
  },
  {
    key: 'provider',
    label: 'Provider',
    width: 'minmax(90px, 0.8fr)',
    sortable: true,
    render: (r) => <span className="text-foreground/80">{r.provider}</span>,
  },
  {
    key: 'model',
    label: 'Model',
    width: 'minmax(140px, 1.2fr)',
    sortable: true,
    render: (r) => <span className="text-foreground/80 truncate">{r.model}</span>,
  },
  {
    key: 'calls',
    label: 'Calls',
    width: '90px',
    align: 'right',
    sortable: true,
    sortFn: (a, b) => a.calls - b.calls,
    render: (r) => <Numeric value={r.calls} />,
  },
  {
    key: 'tokens',
    label: 'Tokens',
    width: '110px',
    align: 'right',
    sortable: true,
    sortFn: (a, b) => a.inputTokens + a.outputTokens - (b.inputTokens + b.outputTokens),
    render: (r) => <Numeric value={r.inputTokens + r.outputTokens} />,
  },
  {
    key: 'cost',
    label: 'Est. $',
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
];

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
  const data = useLlmPinpoints();
  const { activeProject, state, pinpoints, error, cred, timeWindow, setTimeWindow, reload } = data;

  return (
    <div className="h-full w-full flex flex-col min-h-0" data-testid="llm-overview-page">
      {/* Header */}
      <div className="mx-4 mt-3 flex items-center gap-3">
        <BarChart3 className="w-4 h-4 text-primary/70 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="typo-body font-semibold text-foreground">LLM Overview</h2>
          <p className="text-[11px] text-foreground/50">
            Where this project calls an LLM — use case, provider, model, usage and estimated cost.
          </p>
        </div>
        <SegmentedTabs
          tabs={WINDOW_TABS}
          activeTab={timeWindow}
          onTabChange={setTimeWindow}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel="Time window"
        />
        <button
          onClick={reload}
          className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/8 focus-ring"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Layer 1 — assignment matrix */}
      <AssignmentMatrix />

      {/* Layer 2 — pinpoints for the active project */}
      <div className="flex-1 min-h-0 mx-4 my-3 flex flex-col rounded-card border border-primary/10 overflow-hidden">
        {!activeProject ? (
          <StateMessage
            icon={<AlertCircle className="w-8 h-8" />}
            title="No project selected"
            subtitle="Pick a Dev Tools project to see its LLM usage."
          />
        ) : state === 'empty' ? (
          <StateMessage
            icon={<Plug className="w-8 h-8" />}
            title="No LLM-observability connector"
            subtitle="Connect Langfuse, LangSmith, Helicone, or LightTrack in Vault → Connectors, then assign it to this project above."
          />
        ) : state === 'unmapped' ? (
          <StateMessage
            icon={<Plug className="w-8 h-8" />}
            title="Not assigned to this project"
            subtitle="Assign one of your LLM-observability connectors to this project using the matrix above."
          />
        ) : state === 'unsupported' ? (
          <StateMessage
            icon={<Clock className="w-8 h-8" />}
            title={`Live data for ${cred?.serviceType ?? 'this tool'} is coming soon`}
            subtitle="This connector is assigned, but its live adapter lands in a later phase. LightTrack works today."
          />
        ) : state === 'loading' ? (
          <div className="flex-1 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : state === 'error' ? (
          <StateMessage
            icon={<AlertCircle className="w-8 h-8 text-red-400/70" />}
            title="Couldn't load LLM usage"
            subtitle={error ?? 'Unknown error'}
          />
        ) : pinpoints.length === 0 ? (
          <StateMessage
            icon={<BarChart3 className="w-8 h-8" />}
            title="No LLM calls in this window"
            subtitle={`${cred?.name ?? 'The connector'} reported no calls in the last ${timeWindow}. Widen the window or check that the tool is receiving traces.`}
          />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <UnifiedTable
              columns={COLUMNS}
              data={pinpoints}
              getRowKey={(r) => `${r.useCaseName ?? '∅'}|${r.provider}|${r.model}`}
              rowHeight={40}
              density="compact"
              borderless
              defaultSortKey="cost"
              defaultSortDir="desc"
              ariaLabel="LLM pinpoints"
              tableId="llm-overview-pinpoints"
            />
            <div className="px-4 py-1.5 border-t border-primary/10 text-[10px] text-foreground/40">
              Costs are token×price estimates from {cred?.serviceType ?? 'the tool'}, not billed amounts.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
