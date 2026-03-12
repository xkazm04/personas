import { memo } from 'react';
import { ToggleLeft, ToggleRight, ChevronDown, ShieldAlert } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import { TriggerStatusSummary } from './TriggerStatusSummary';

interface TriggerRowProps {
  trigger: DbPersonaTrigger;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
}

/** Collapsed trigger row: always visible, shows type + config summary + toggle + expand. */
export const TriggerRow = memo(function TriggerRow({ trigger, expanded, onToggleExpand, onToggleEnabled }: TriggerRowProps) {
  const budgetStatus = usePersonaStore((s) => s.getBudgetStatus(trigger.persona_id));

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex items-center gap-2.5 w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl"
      >
        <TriggerStatusSummary trigger={trigger} />

        <span className="ml-auto flex items-center gap-2">
          {/* Budget badges */}
          {budgetStatus === 'stale' && trigger.enabled && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-sm rounded border border-muted-foreground/20 bg-muted/10 text-muted-foreground/80" title="Budget data unavailable">
              <ShieldAlert className="w-3 h-3" />
              Unknown Budget
            </span>
          )}
          {budgetStatus === 'exceeded' && trigger.enabled && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-sm rounded border border-red-500/20 bg-red-500/10 text-red-400/80" title="Monthly budget exceeded -- trigger paused">
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
            className="p-0.5 hover:bg-secondary/60 rounded-lg transition-colors"
            title={trigger.enabled ? 'Disable' : 'Enable'}
          >
            {trigger.enabled ? (
              <ToggleRight className="w-5 h-5 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-muted-foreground/80" />
            )}
          </span>

          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/80 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
        </span>
      </button>
    </motion.div>
  );
});
