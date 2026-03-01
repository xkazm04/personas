import { ToggleLeft, ToggleRight, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { TriggerStatusSummary } from './TriggerStatusSummary';

interface TriggerRowProps {
  trigger: DbPersonaTrigger;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
}

/** Collapsed trigger row: always visible, shows type + config summary + toggle + expand. */
export function TriggerRow({ trigger, expanded, onToggleExpand, onToggleEnabled }: TriggerRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex items-center gap-2.5 w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl"
      >
        <TriggerStatusSummary trigger={trigger} />

        <span className="ml-auto flex items-center gap-2">
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
}
