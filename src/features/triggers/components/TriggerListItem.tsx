import { useState, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import { extractRateLimit, type TriggerRateLimitConfig } from '@/lib/utils/triggerConstants';
import { TriggerRow } from './TriggerRow';
import { TriggerDetailDrawer } from './TriggerDetailDrawer';
import { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';

export interface TriggerListItemProps {
  trigger: DbPersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
  onDelete: (triggerId: string) => void;
}

/** Parse the trigger's raw config into a plain object. */
function parseRawConfig(config: string | null): Record<string, unknown> {
  if (!config) return {};
  try { return JSON.parse(config); } catch { return {}; }
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
  const updateTrigger = usePersonaStore((s) => s.updateTrigger);
  const rateLimitState = usePersonaStore((s) => s.triggerRateLimits[trigger.id] ?? null);

  const rateLimit = useMemo(
    () => extractRateLimit(parseRawConfig(trigger.config)),
    [trigger.config],
  );

  const handleRateLimitChange = useCallback(
    (updated: TriggerRateLimitConfig) => {
      const raw = parseRawConfig(trigger.config);
      raw.rate_limit = updated;
      updateTrigger(trigger.persona_id, trigger.id, { config: raw });
    },
    [trigger.id, trigger.persona_id, trigger.config, updateTrigger],
  );

  return (
    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl transition-colors hover:border-primary/25">
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
            rateLimit={rateLimit}
            rateLimitState={rateLimitState}
            onRateLimitChange={handleRateLimitChange}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
