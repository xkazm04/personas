import { memo } from 'react';
import { ToggleLeft, ToggleRight, ChevronDown, ShieldAlert, Moon, CalendarX } from 'lucide-react';
import type { PersonaTrigger } from '@/lib/types/types';
import { useAgentStore } from "@/stores/agentStore";
import { TriggerStatusSummary } from './TriggerStatusSummary';
import { TriggerModeBadge } from './TriggerModeBadge';
import { getTriggerArmState } from './triggerArmState';
import { useTranslation } from '@/i18n/useTranslation';

interface TriggerRowProps {
  trigger: PersonaTrigger;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
}

/** Collapsed trigger row: always visible, shows type + config summary + toggle + expand. */
export const TriggerRow = memo(function TriggerRow({ trigger, expanded, onToggleExpand, onToggleEnabled }: TriggerRowProps) {
  const { t, tx } = useTranslation();
  const budgetStatus = useAgentStore((s) => s.getBudgetStatus(trigger.persona_id));
  const armState = getTriggerArmState(trigger);

  return (
    <div className="animate-fade-slide-in"
    >
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex items-center gap-2.5 w-full p-3 text-left focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-modal"
      >
        <TriggerStatusSummary trigger={trigger} />

        <span className="ml-auto flex items-center gap-2">
          {/* Fire-mode ("armed to do what") + sleeping state, so an enabled-but-
              outside-active-window trigger no longer reads identically to disabled. */}
          <TriggerModeBadge trigger={trigger} />
          {/* A time-based trigger with no next fire time. `get_due` requires
              `next_trigger_at IS NOT NULL`, so this row can never become due —
              it used to render as "armed" and simply never run. */}
          {armState === 'unschedulable' && (
            <span
              className="flex items-center gap-1 typo-body text-status-warning"
              title={t.triggers.arm_state.unschedulable_title}
            >
              <CalendarX className="w-3 h-3" />
              {t.triggers.arm_state.unschedulable}
            </span>
          )}
          {armState === 'sleeping' && (
            <span
              className="flex items-center gap-1 typo-body text-role-agent"
              title={t.triggers.arm_state.sleeping_title}
            >
              <Moon className="w-3 h-3" />
              {t.triggers.arm_state.sleeping}
            </span>
          )}
          {/* Budget badges */}
          {budgetStatus === 'stale' && trigger.enabled && (
            <span className="flex items-center gap-1 typo-body border-muted-foreground/20 text-ink-1" title={t.triggers.list.budget_unavailable}>
              <ShieldAlert className="w-3 h-3" />
              {t.triggers.unknown_budget_label}
            </span>
          )}
          {budgetStatus === 'exceeded' && trigger.enabled && (
            <span className="flex items-center gap-1 typo-body text-status-error" title={t.triggers.list.budget_exceeded}>
              <ShieldAlert className="w-3 h-3" />
              Budget
            </span>
          )}
          {/* Enabled toggle (stop propagation so it doesn't toggle expand) */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onToggleEnabled(trigger.id, trigger.enabled); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleEnabled(trigger.id, trigger.enabled); } }}
            className="p-0.5 hover:bg-surface-2 rounded-card transition-colors"
            title={trigger.enabled ? tx(t.common.disable_item, { name: '' }) : tx(t.common.enable_item, { name: '' })}
          >
            {trigger.enabled ? (
              <ToggleRight className="w-5 h-5 text-status-success" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-ink-1" />
            )}
          </span>

          <ChevronDown className={`w-3.5 h-3.5 text-ink-1 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
        </span>
      </button>
    </div>
  );
});
