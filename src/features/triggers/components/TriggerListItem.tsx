import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { TriggerRow } from './TriggerRow';
import { TriggerDetailDrawer } from './TriggerDetailDrawer';
import { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';

export interface TriggerListItemProps {
  trigger: DbPersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
  onDelete: (triggerId: string) => void;
}

/**
 * Single trigger item: collapsed row + expandable detail drawer.
 *
 * All async state (test-fire, dry-run, activity, delete confirmation,
 * clipboard) is managed by the useTriggerDetail hook, keeping this
 * component as a thin composition layer.
 */
export function TriggerListItem({
  trigger,
  credentialEventsList,
  onToggleEnabled,
  onDelete,
}: TriggerListItemProps) {
  const [expanded, setExpanded] = useState(false);
  const detail = useTriggerDetail(trigger.id, trigger.persona_id);

  return (
    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl transition-colors hover:border-primary/25">
      <TriggerRow
        trigger={trigger}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onToggleEnabled={onToggleEnabled}
      />

      <AnimatePresence initial={false}>
        {expanded && (
          <TriggerDetailDrawer
            trigger={trigger}
            credentialEventsList={credentialEventsList}
            detail={detail}
            onDelete={onDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
