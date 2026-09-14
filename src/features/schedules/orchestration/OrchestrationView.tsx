// OrchestrationView — the Schedules page's autonomous-agent layer.
//
// The schedule module was built for a world of time-triggered personas: a
// trigger fires at a moment, and the calendar shows the moments. Autopilot
// adds a second population that has no moment at all — personas the attention
// loop wakes on its own tick, as many per tick as the pacing allows — and the
// question for them is not WHEN but IN WHAT ORDER. This tab answers it: the
// operator's global dispatch order (dragged into place, persisted whole), and
// what the next tick would do with each persona by the loop's own admission
// ladder, computed without spending anything.
//
// TODO(prototype, 2026-09-14): consolidate the variant switcher below once
// the operator picks a direction (Runway / Ledger / Slots).

import { useState } from 'react';
import { Bot, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import Button from '@/features/shared/components/buttons/Button';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useDispatchOrder } from './useDispatchOrder';
import { BudgetBand } from './parts';
import { RunwayVariant } from './RunwayVariant';
import { LedgerVariant } from './LedgerVariant';
import { SlotsVariant } from './SlotsVariant';

type Variant = 'runway' | 'ledger' | 'slots';
const PREFIX = 'orchestration-variant';

/** A ghost under the permanent chrome while the first read is in flight. */
function Ghost() {
  return (
    <div aria-hidden className="space-y-2 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 rounded-card border border-border/60 bg-primary/[0.04]" />
      ))}
    </div>
  );
}

export function OrchestrationView() {
  const { t } = useTranslation();
  const s = t.schedules;
  const state = useDispatchOrder();
  const [variant, setVariant] = useState<Variant>('runway');
  const { view, rows, failed, saving, reset } = state;

  const tabs = [
    { id: 'runway' as const, label: s.orch_variant_runway },
    { id: 'ledger' as const, label: s.orch_variant_ledger },
    { id: 'slots' as const, label: s.orch_variant_slots },
  ];

  return (
    <div className="space-y-4" data-testid="orchestration-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl space-y-1">
          <p className="typo-body text-foreground">{s.orch_intro}</p>
          {view && <BudgetBand view={view} />}
          {failed && !view && <p className="typo-caption text-status-error">{s.orch_unavailable}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw size={12} />}
            onClick={reset}
            disabled={saving || !view || view.dispatchOrder.length === 0}
          >
            {s.orch_reset}
          </Button>
          <SegmentedTabs tabs={tabs} activeTab={variant} onTabChange={setVariant} idPrefix={PREFIX} size="sm" ariaLabel={s.orch_variant_aria} />
        </div>
      </div>

      <div {...segmentedTabPanelProps(PREFIX, variant)}>
        {!view ? (
          failed ? null : <Ghost />
        ) : rows.length === 0 ? (
          <ScenarioEmptyState icon={Bot} title={s.orch_empty_title} description={s.orch_empty_hint} />
        ) : variant === 'runway' ? (
          <RunwayVariant state={state} />
        ) : variant === 'ledger' ? (
          <LedgerVariant state={state} view={view} />
        ) : (
          <SlotsVariant state={state} view={view} />
        )}
      </div>
    </div>
  );
}

export default OrchestrationView;
