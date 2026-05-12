import { useState, useMemo, useCallback } from 'react';
import type { PersonaTrigger } from '@/lib/types/types';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { usePipelineStore } from "@/stores/pipelineStore";
import { extractRateLimit, type TriggerRateLimitConfig } from '@/lib/utils/platform/triggerConstants';
import { TriggerRow } from './TriggerRow';
import { TriggerDetailDrawer } from './TriggerDetailDrawer';

export interface TriggerListItemProps {
  trigger: PersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  onToggleEnabled: (triggerId: string, currentEnabled: boolean) => void;
  onDelete: (triggerId: string) => void;
}

/** Parse the trigger's raw config into a plain object. */
function parseRawConfig(config: string | null): Record<string, unknown> {
  return parseJsonOrDefault<Record<string, unknown>>(config, {});
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
  const updateTrigger = usePipelineStore((s) => s.updateTrigger);
  const rateLimitState = usePipelineStore((s) => s.triggerRateLimits[trigger.id] ?? null);

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

  const handleActiveWindowChange = useCallback(
    (updated: Record<string, unknown>) => {
      updateTrigger(trigger.persona_id, trigger.id, { config: updated });
    },
    [trigger.id, trigger.persona_id, updateTrigger],
  );

  return (
    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-modal transition-colors hover:border-primary/25">
      <TriggerRow
        trigger={trigger}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onToggleEnabled={onToggleEnabled}
      />

      {expanded && (
          <TriggerDetailDrawer
            trigger={trigger}
            credentialEventsList={credentialEventsList}
            onDelete={onDelete}
            rateLimit={rateLimit}
            rateLimitState={rateLimitState}
            onRateLimitChange={handleRateLimitChange}
            rawConfig={parseRawConfig(trigger.config)}
            onActiveWindowChange={handleActiveWindowChange}
          />
        )}
    </div>
  );
}
