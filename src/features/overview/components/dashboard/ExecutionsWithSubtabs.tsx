import { lazy, Suspense, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import {
  SegmentedTabs,
  segmentedTabPanelProps,
  type SegmentedTab,
} from '@/features/shared/components/layout/SegmentedTabs';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import GlobalExecutionList from '@/features/overview/sub_activity/components/GlobalExecutionList';

// Neither of these is reached on the default (Activity) lens, so keep both out
// of the Activity view's initial chunk: the per-call LLM usage table, and the
// metrics dashboard with its whole chart stack.
const LlmCallsTable = lazy(() => import('@/features/overview/sub_activity/components/LlmCallsTable'));
const ExecutionMetricsDashboard = lazy(() =>
  import('@/features/overview/sub_activity/components/ExecutionMetricsDashboard').then((m) => ({
    default: m.ExecutionMetricsDashboard,
  })),
);

type Subtab = 'activity' | 'calls' | 'metrics';

const TAB_PREFIX = 'overview-executions';

/**
 * Overview › Executions: three lenses over the same execution stream.
 *  - **Activity** — the operational execution ledger (status, model, cost, …).
 *  - **Calls** — a per-call LLM usage table (model + thinking effort, input /
 *    output tokens, cost) for auditing spend locally, no external tracker.
 *  - **Metrics** — the aggregate dashboard over the same runs.
 *
 * ONE HEADER, OWNED HERE, CONSTANT ACROSS ALL THREE (2026-10-04, owner:
 * "Consolidate tab switcher in header … with each tab switch the header should
 * not disappear, should be consistent for each tab content").
 *
 * Before, this component rendered no chrome of its own: it swapped whole
 * sibling components and injected the switcher INTO each one as a prop. Only
 * Activity owned a `ContentHeader`, Calls hand-rolled a thin toolbar strip
 * instead, and Metrics was not a tab at all but a toggle button inside
 * Activity's header — so moving between the three changed the header's
 * identity, and on Calls removed it outright. The header (icon, surface name,
 * the recorded count, and the one switcher) now lives here and nothing below
 * the band re-renders it; only the body changes.
 *
 * The count comes from the store, not from a fetch of this component's own:
 * `globalExecutionCounts` is what both tables already load, and the default
 * lens is Activity, so the number is warm before any other lens can be reached.
 *
 * Per-tab controls (Activity's status filters and refresh, Calls' time window,
 * Metrics' day range and compare toggle) stay with their own tab, on a control
 * band of one shared geometry directly under this header — the shape of the
 * reference surface, `sub_events/EventLogList` (ContentHeader → toolbar →
 * body). Hoisting them here would mean lifting three independent data hooks
 * into one component, which would run the metrics IPC on the Activity lens and
 * break law 6 of docs/design/overview-loading.md.
 */
export default function ExecutionsWithSubtabs() {
  const { t, tx } = useTranslation();
  const [subtab, setSubtab] = useState<Subtab>('activity');
  const total = useOverviewStore((s) => s.globalExecutionCounts.total);

  const tabs = useMemo<SegmentedTab<Subtab>[]>(
    () => [
      { id: 'activity', label: t.overview.activity.title, testId: 'exec-tab-activity' },
      { id: 'calls', label: t.overview.llm_spend.calls, testId: 'exec-tab-calls' },
      { id: 'metrics', label: t.overview.activity.metrics, testId: 'exec-tab-metrics' },
    ],
    [t],
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={<Activity className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title={t.overview.executions.title}
        subtitle={tx(total !== 1 ? t.overview.activity.recorded : t.overview.activity.recorded_one, { count: total })}
        actions={
          <SegmentedTabs<Subtab>
            tabs={tabs}
            activeTab={subtab}
            onTabChange={setSubtab}
            variant="segment"
            size="sm"
            fullWidth={false}
            idPrefix={TAB_PREFIX}
            ariaLabel={t.overview.executions.title}
          />
        }
      />

      <div
        {...segmentedTabPanelProps(TAB_PREFIX, subtab)}
        key={subtab}
        className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
      >
        {subtab === 'activity' ? (
          <GlobalExecutionList />
        ) : (
          // Placeholder for the code-split chunk fetch (not the data fetch —
          // each view gates that itself). Per docs/design/overview-loading.md
          // §D: invisible for 150ms (so a fast chunk load never paints
          // anything) and reserves the pane's height so the page doesn't
          // shift; it must NOT fake either body's geometry, since the two
          // differ and the chrome they share is already rendered above.
          <Suspense
            fallback={<div className="flex-1 min-h-0 animate-fade-in" style={{ animationDelay: '150ms' }} />}
          >
            {subtab === 'calls' ? (
              <LlmCallsTable />
            ) : (
              // The anomaly drill-down parks an execution id and hands the
              // operator back to the ledger that can open it.
              <ExecutionMetricsDashboard onClose={() => setSubtab('activity')} />
            )}
          </Suspense>
        )}
      </div>
    </ContentBox>
  );
}
