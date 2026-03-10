import { Zap, ToggleLeft, ToggleRight } from 'lucide-react';
import { DesignCheckbox } from './DesignCheckbox';
import { triggerIconMeta, SECTION_LABEL } from './helpers';
import type { AgentIR, SuggestedTrigger } from '@/lib/types/designTypes';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { parseTriggerConfig } from '@/lib/utils/triggerConstants';

interface EventsSectionProps {
  result: AgentIR;
  selectedTriggerIndices: Set<number>;
  onTriggerToggle: (index: number) => void;
  suggestedSubscriptions?: Array<{ event_type: string; source_filter?: object; description: string }>;
  selectedSubscriptionIndices: Set<number>;
  onSubscriptionToggle?: (idx: number) => void;
  readOnly: boolean;
  actualTriggers: DbPersonaTrigger[];
  onTriggerEnabledToggle?: (triggerId: string, enabled: boolean) => void;
}

export function EventsSection({
  result,
  selectedTriggerIndices,
  onTriggerToggle,
  suggestedSubscriptions,
  selectedSubscriptionIndices,
  onSubscriptionToggle,
  readOnly,
  actualTriggers,
  onTriggerEnabledToggle,
}: EventsSectionProps) {
  const hasTriggers = result.suggested_triggers.length > 0 || (readOnly && actualTriggers.length > 0);
  const hasSubscriptions = suggestedSubscriptions && suggestedSubscriptions.length > 0;

  if (!hasTriggers && !hasSubscriptions) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Zap className="w-4 h-4 text-amber-400" />
        Events & Triggers
        <span className="text-sm font-normal text-muted-foreground/80 ml-1">What activates this persona</span>
      </div>

      <div className="bg-secondary/20 border border-primary/10 rounded-xl overflow-hidden divide-y divide-primary/[0.06]">
        {/* Triggers */}
        {hasTriggers && (
          <div className="p-3.5 space-y-2">
            <span className="text-sm font-mono uppercase tracking-wider text-muted-foreground/80">Triggers</span>
            {readOnly && actualTriggers.length > 0 ? (
              actualTriggers.map((trigger) => {
                const config = parseTriggerConfig(trigger.trigger_type, trigger.config);
                const intervalSec = (config.type === 'schedule' || config.type === 'polling') ? config.interval_seconds : undefined;
                return (
                  <div key={trigger.id} className="flex items-center gap-2.5 py-1">
                    <div className="flex-shrink-0">{(() => { const { Icon, color } = triggerIconMeta(trigger.trigger_type as SuggestedTrigger['trigger_type']); return <Icon className={`w-4 h-4 ${color}`} />; })()}</div>
                    <span className={`text-sm capitalize truncate flex-1 ${trigger.enabled ? 'text-foreground/90' : 'text-muted-foreground/80'}`}>
                      {trigger.trigger_type}
                      {intervalSec ? ` (${intervalSec}s)` : ''}
                    </span>
                    {onTriggerEnabledToggle && (
                      <button
                        onClick={() => onTriggerEnabledToggle(trigger.id, !trigger.enabled)}
                        className="flex-shrink-0 p-0.5 rounded transition-colors hover:bg-secondary/50"
                        title={trigger.enabled ? 'Disable' : 'Enable'}
                      >
                        {trigger.enabled ? (
                          <ToggleRight className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-muted-foreground/80" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              result.suggested_triggers.map((trigger, trigIdx) => {
                const isSelected = selectedTriggerIndices.has(trigIdx);
                return (
                  <div key={trigIdx} className="flex items-start gap-2.5 py-1">
                    {!readOnly && (
                      <div className="mt-0.5">
                        <DesignCheckbox
                          checked={isSelected}
                          onChange={() => onTriggerToggle(trigIdx)}
                        />
                      </div>
                    )}
                    <div className="flex-shrink-0 mt-0.5">{(() => { const { Icon, color } = triggerIconMeta(trigger.trigger_type); return <Icon className={`w-4 h-4 ${color}`} />; })()}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground/90 capitalize block">{trigger.trigger_type}</span>
                      <span className="text-sm text-muted-foreground/80 leading-snug block">{trigger.description}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Event Subscriptions */}
        {hasSubscriptions && (
          <div className="p-3.5 space-y-2">
            <span className="text-sm font-mono uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-purple-400" />
              Event Subscriptions
            </span>
            {suggestedSubscriptions!.map((sub, subIdx) => {
              const isSelected = selectedSubscriptionIndices.has(subIdx);
              return (
                <div key={`sub-${subIdx}`} className="flex items-start gap-2.5 py-1">
                  {!readOnly && (
                    <div className="mt-0.5">
                      <DesignCheckbox
                        checked={!!isSelected}
                        onChange={() => onSubscriptionToggle?.(subIdx)}
                        color="purple"
                      />
                    </div>
                  )}
                  <Zap className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground/90 block">{sub.event_type}</span>
                    <span className="text-sm text-muted-foreground/80 leading-snug block">{sub.description}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
