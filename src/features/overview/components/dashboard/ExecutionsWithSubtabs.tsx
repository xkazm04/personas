import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import GlobalExecutionList from '@/features/overview/sub_activity/components/GlobalExecutionList';

// The per-call LLM usage table is only reached via the "Calls" subtab, so keep
// it out of the Activity view's initial chunk.
const LlmCallsTable = lazy(() => import('@/features/overview/sub_activity/components/LlmCallsTable'));

type Subtab = 'activity' | 'calls';

/**
 * Executions surface with two lenses over the same execution stream:
 *  - **Activity** — the operational execution list (status, model, cost, …).
 *  - **Calls** — a per-call LLM usage table (model + thinking effort, input /
 *    output tokens, cost) for auditing spend locally, no external tracker.
 *
 * One `SegmentedTabs` switcher is defined here and handed to whichever view is
 * active (Activity via its `headerActions` slot, Calls via its toolbar) so the
 * control sits in one header row instead of adding a second chrome bar.
 */
export default function ExecutionsWithSubtabs() {
  const { t } = useTranslation();
  const [subtab, setSubtab] = useState<Subtab>('activity');

  const tabs = useMemo<SegmentedTab<Subtab>[]>(
    () => [
      { id: 'activity', label: t.overview.activity.title },
      { id: 'calls', label: t.overview.llm_spend.calls },
    ],
    [t],
  );

  const switcher = (
    <SegmentedTabs<Subtab>
      tabs={tabs}
      activeTab={subtab}
      onTabChange={setSubtab}
      variant="segment"
      size="sm"
      fullWidth={false}
      ariaLabel={t.overview.activity.title}
    />
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="animate-fade-slide-in flex-1 min-h-0 flex flex-col">
        {subtab === 'activity' ? (
          <GlobalExecutionList headerActions={switcher} />
        ) : (
          <Suspense fallback={null}>
            <LlmCallsTable headerSwitch={switcher} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
