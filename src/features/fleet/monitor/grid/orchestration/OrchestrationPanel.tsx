// OrchestrationPanel — the Activity board's autonomous-agent layer, in a modal.
//
// Was `OrchestrationView`, the third tab of the Schedules page. The schedule
// module was built for a world of time-triggered personas: a trigger fires at
// a moment, and the calendar shows the moments. Autopilot adds a second
// population that has no moment at all — personas the attention loop wakes on
// its own tick, as many per tick as the pacing allows — and the question for
// them is not WHEN but WHAT THE NEXT TICK WOULD DO. That is a Monitor
// question, so the ledger lives here now, opened from the board.
//
// The panel is read-only: the next-tick preview computed by the loop's own
// admission ladder without spending anything, the four counters, the Active
// switch per persona, refusal chips and the budget band. The dispatch-order
// editor (drag, ↑/↓, "order by need") is gone — order editing is being
// replaced by the board queue.
//
// Wiring: nothing opens this yet; the board header gets its button in a later
// package. It is exported from `./index.ts` for that.

import { Bot, ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useDispatchPreview } from './useDispatchPreview';
import { BudgetBand } from './parts';
import { OrchestrationLedger } from './OrchestrationLedger';

const TITLE_ID = 'orchestration-panel-title';

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

/** The panel body — the hook mounts (and polls) only while the panel is open. */
function OrchestrationBody() {
  const { t } = useTranslation();
  const s = t.monitor;
  const state = useDispatchPreview();
  const { view, rows, failed } = state;

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4" data-testid="orchestration-view">
      <div className="min-w-0">
        {view && <BudgetBand view={view} />}
        {failed && !view && <p className="typo-caption text-status-error">{s.orch_unavailable}</p>}
      </div>

      {!view ? (
        failed ? null : <Ghost />
      ) : rows.length === 0 ? (
        <ScenarioEmptyState icon={Bot} title={s.orch_empty_title} description={s.orch_empty_hint} />
      ) : (
        <OrchestrationLedger state={state} view={view} />
      )}
    </div>
  );
}

export function OrchestrationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId={TITLE_ID}
      size="full"
      portal
      staggerChildren={false}
      panelClassName="flex max-h-[85vh] flex-col"
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
          <ListOrdered className="h-3.5 w-3.5 text-foreground" aria-hidden />
        </div>
        <h2 id={TITLE_ID} className="min-w-0 truncate typo-title">{t.monitor.orch_panel_title}</h2>
        <span className="ml-auto min-w-0 truncate typo-caption text-foreground opacity-60">
          {t.monitor.orch_panel_subtitle}
        </span>
      </div>
      {open && <OrchestrationBody />}
    </BaseModal>
  );
}

export default OrchestrationPanel;
