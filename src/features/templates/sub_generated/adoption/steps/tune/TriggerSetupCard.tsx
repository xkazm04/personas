import { Zap } from 'lucide-react';
import { cardClass, descClass, fieldClass, inputClass, labelClass, TRIGGER_ICONS } from './tuneStepConstants';
import type { SuggestedTrigger } from '@/lib/types/designTypes';
import { BORDER_SUBTLE } from '@/lib/utils/designTokens';

interface SelectedTriggerEntry {
  trigger: SuggestedTrigger;
  originalIndex: number;
}

export function TriggerSetupCard({
  selectedTriggers,
  triggerConfigs,
  onUpdateTriggerConfig,
}: {
  selectedTriggers: SelectedTriggerEntry[];
  triggerConfigs: Record<number, Record<string, string>>;
  onUpdateTriggerConfig: (index: number, config: Record<string, string>) => void;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-amber-400/70"><Zap className="w-4 h-4" /></span>
        <span className="text-sm font-medium text-foreground/70">Trigger Setup</span>
      </div>

      {selectedTriggers.length === 0 ? (
        <p className="text-sm text-muted-foreground/40 italic">No triggers selected</p>
      ) : (
        <div className="flex flex-col gap-3">
          {selectedTriggers.map(({ trigger, originalIndex }) => {
            const Icon = TRIGGER_ICONS[trigger.trigger_type];
            const currentConfig = triggerConfigs[originalIndex] ?? {};

            return (
              <div key={originalIndex} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-amber-500/70" />
                  <span className="text-sm font-medium text-foreground/80 capitalize">
                    {trigger.trigger_type}
                  </span>
                </div>
                {trigger.description && (
                  <p className={descClass}>{trigger.description}</p>
                )}

                {trigger.trigger_type === 'schedule' && (
                  <div className={fieldClass}>
                    <label className={labelClass}>When should this run?</label>
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="Every weekday at 9am"
                      value={
                        currentConfig.schedule ??
                        currentConfig.cron ??
                        (trigger.config.cron as string | undefined) ??
                        trigger.description ??
                        ''
                      }
                      onChange={(e) =>
                        onUpdateTriggerConfig(originalIndex, {
                          ...currentConfig,
                          schedule: e.target.value,
                        })
                      }
                    />
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                      Natural language (e.g. "Every weekday at 9am") or cron (e.g. "0 9 * * 1-5")
                    </p>
                  </div>
                )}

                {trigger.trigger_type === 'webhook' && (
                  <div className={fieldClass}>
                    <label className={labelClass}>Webhook URL</label>
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="https://..."
                      value={
                        currentConfig.url ??
                        (trigger.config.url as string | undefined) ??
                        ''
                      }
                      onChange={(e) =>
                        onUpdateTriggerConfig(originalIndex, {
                          ...currentConfig,
                          url: e.target.value,
                        })
                      }
                    />
                  </div>
                )}

                {trigger.trigger_type === 'polling' && (
                  <div className={fieldClass}>
                    <label className={labelClass}>Check interval</label>
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="Every 5 minutes"
                      value={
                        currentConfig.interval ??
                        (trigger.config.interval as string | undefined) ??
                        ''
                      }
                      onChange={(e) =>
                        onUpdateTriggerConfig(originalIndex, {
                          ...currentConfig,
                          interval: e.target.value,
                        })
                      }
                    />
                  </div>
                )}

                {trigger.trigger_type === 'manual' && (
                  <p className="text-sm text-muted-foreground/40 italic">
                    Triggered manually -- no configuration needed
                  </p>
                )}

                {trigger.trigger_type === 'event' && (
                  <p className="text-sm text-muted-foreground/40 italic">
                    Triggered by system events -- no configuration needed
                  </p>
                )}

                {/* Separator between triggers */}
                {selectedTriggers.length > 1 && originalIndex !== selectedTriggers[selectedTriggers.length - 1]?.originalIndex && (
                  <div className={`border-t ${BORDER_SUBTLE} mt-1`} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
