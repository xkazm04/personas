import { memo } from 'react';
import { ToggleLeft, ToggleRight, ChevronDown, ShieldAlert, Moon, CalendarX } from 'lucide-react';
import type { PersonaTrigger } from '@/lib/types/types';
import { useAgentStore } from "@/stores/agentStore";
import { TriggerStatusSummary } from './TriggerStatusSummary';
import { TriggerModeBadge } from './TriggerModeBadge';
import { getTriggerArmState } from './triggerArmState';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
            <Tooltip content={t.triggers.arm_state.unschedulable_title}><span
              className="flex items-center gap-1 typo-body text-status-warning">
              <CalendarX className="w-3 h-3" />
              {t.triggers.arm_state.unschedulable}
            </span></Tooltip>
          )}
          {armState === 'sleeping' && (
            <Tooltip content={t.triggers.arm_state.sleeping_title}><span
              className="flex items-center gap-1 typo-body text-role-agent">
              <Moon className="w-3 h-3" />
              {t.triggers.arm_state.sleeping}
            </span></Tooltip>
          )}
          {/* Budget badges */}
          {budgetStatus === 'stale' && trigger.enabled && (
            <Tooltip content={t.triggers.list.budget_unavailable}><span className="flex items-center gap-1 typo-body border-muted-foreground/20 text-ink-1">
              <ShieldAlert className="w-3 h-3" />
              {t.triggers.unknown_budget_label}
            </span></Tooltip>
          )}
          {budgetStatus === 'exceeded' && trigger.enabled && (
            <Tooltip content={t.triggers.list.budget_exceeded}><span className="flex items-center gap-1 typo-body text-status-error">
              <ShieldAlert className="w-3 h-3" />
              Budget
            </span></Tooltip>
          )}
          {/* Enabled toggle (stop propagation so it doesn't toggle expand) */}
          <Tooltip content={trigger.enabled ? tx(t.common.disable_item, { name: '' }) : tx(t.common.enable_item, { name: '' })}><span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onToggleEnabled(trigger.id, trigger.enabled); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleEnabled(trigger.id, trigger.enabled); } }}
            className="p-0.5 hover:bg-surface-2 rounded-card transition-colors">
            {trigger.enabled ? (
              <ToggleRight className="w-5 h-5 text-status-success" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-ink-1" />
            )}
          </span></Tooltip>

          <ChevronDown className={`w-3.5 h-3.5 text-ink-1 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
        </span>
      </button>
    </div>
  );
});
