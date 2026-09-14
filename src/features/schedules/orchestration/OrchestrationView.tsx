// OrchestrationView — the Schedules page's autonomous-agent layer.
//
// The schedule module was built for a world of time-triggered personas: a
// trigger fires at a moment, and the calendar shows the moments. Autopilot
// adds a second population that has no moment at all — personas the attention
// loop wakes on its own tick, as many per tick as the pacing allows — and the
// question for them is not WHEN but IN WHAT ORDER. This view answers it: the
// operator's global dispatch order (dragged into place, persisted whole), and
// what the next tick would do with each persona by the loop's own admission
// ladder, computed without spending anything.
//
// The Ledger won the 2026-09-14 prototype round over a departure-board
// (Runway) and a control-room (Slots) layout: every input of the admission
// ladder is a column and the verdict is the last one, so the operator reads
// WHY a persona waits in the same row as the fact that it does.

import { Bot, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useDispatchOrder } from './useDispatchOrder';
import { BudgetBand } from './parts';
import { LedgerVariant } from './LedgerVariant';

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
  const { view, rows, failed, saving, reset } = state;

  return (
    <div className="space-y-4" data-testid="orchestration-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {view && <BudgetBand view={view} />}
          {failed && !view && <p className="typo-caption text-status-error">{s.orch_unavailable}</p>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw size={12} />}
          onClick={reset}
          disabled={saving || !view || view.dispatchOrder.length === 0}
        >
          {s.orch_reset}
        </Button>
      </div>

      {!view ? (
        failed ? null : <Ghost />
      ) : rows.length === 0 ? (
        <ScenarioEmptyState icon={Bot} title={s.orch_empty_title} description={s.orch_empty_hint} />
      ) : (
        <LedgerVariant state={state} view={view} />
      )}
    </div>
  );
}

export default OrchestrationView;
