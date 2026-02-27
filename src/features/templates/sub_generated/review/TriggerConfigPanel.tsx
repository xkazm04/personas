import { Clock, Webhook, MousePointerClick, Radio } from 'lucide-react';
import type { SuggestedTrigger } from '@/lib/types/designTypes';

interface TriggerConfigPanelProps {
  triggers: SuggestedTrigger[];
  selectedIndices: Set<number>;
  configs: Record<number, Record<string, string>>;
  onConfigChange: (triggerIdx: number, config: Record<string, string>) => void;
}

const TRIGGER_ICONS: Record<SuggestedTrigger['trigger_type'], typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
};

export function TriggerConfigPanel({
  triggers,
  selectedIndices,
  configs,
  onConfigChange,
}: TriggerConfigPanelProps) {
  const selected = triggers
    .map((t, i) => ({ trigger: t, originalIndex: i }))
    .filter(({ originalIndex }) => selectedIndices.has(originalIndex));

  if (selected.length === 0) return null;

  const inputClass =
    'w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-lg text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/30 transition-colors';

  return (
    <div className="flex flex-col gap-3">
      {selected.map(({ trigger, originalIndex }) => {
        const Icon = TRIGGER_ICONS[trigger.trigger_type];
        const currentConfig = configs[originalIndex] ?? {};

        return (
          <div
            key={originalIndex}
            className="flex items-start gap-4 px-4 py-3.5 rounded-xl border border-primary/10 bg-secondary/20"
          >
            {/* Left side: icon + label + description */}
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-amber-500" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-foreground capitalize">
                  {trigger.trigger_type}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {trigger.description}
                </p>
              </div>
            </div>

            {/* Right side: config form */}
            <div className="flex-1 min-w-0">
              {trigger.trigger_type === 'schedule' && (
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1.5">
                    Cron Schedule
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="*/15 * * * *"
                    value={
                      currentConfig.cron ??
                      (trigger.config.cron as string | undefined) ??
                      ''
                    }
                    onChange={(e) =>
                      onConfigChange(originalIndex, {
                        ...currentConfig,
                        cron: e.target.value,
                      })
                    }
                  />
                </div>
              )}

              {trigger.trigger_type === 'webhook' && (
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1.5">
                    Webhook URL
                  </label>
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
                      onConfigChange(originalIndex, {
                        ...currentConfig,
                        url: e.target.value,
                      })
                    }
                  />
                </div>
              )}

              {trigger.trigger_type === 'polling' && (
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1.5">
                    Interval (seconds)
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    placeholder="60"
                    value={
                      currentConfig.interval ??
                      (trigger.config.interval as string | undefined) ??
                      ''
                    }
                    onChange={(e) =>
                      onConfigChange(originalIndex, {
                        ...currentConfig,
                        interval: e.target.value,
                      })
                    }
                  />
                </div>
              )}

              {trigger.trigger_type === 'manual' && (
                <p className="text-xs text-muted-foreground italic pt-1.5">
                  Triggered manually — no configuration needed
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
