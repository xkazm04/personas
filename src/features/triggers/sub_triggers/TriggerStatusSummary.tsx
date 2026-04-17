import type { PersonaTrigger } from '@/lib/types/types';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig, getTriggerCategoryMeta, getTriggerTypeLabel } from '@/lib/utils/platform/triggerConstants';
import { formatInterval } from '@/lib/utils/formatters';

interface TriggerStatusSummaryProps {
  trigger: PersonaTrigger;
}

/** Shared type icon + config badge summary for collapsed trigger rows and list overview. */
export function TriggerStatusSummary({ trigger }: TriggerStatusSummaryProps) {
  const meta = TRIGGER_TYPE_META[trigger.trigger_type] || DEFAULT_TRIGGER_META;
  const Icon = meta.Icon;
  const colorClass = meta.color;
  const config = parseTriggerConfig(trigger.trigger_type, trigger.config);
  const catMeta = getTriggerCategoryMeta(trigger.trigger_type);

  const parts: string[] = [];

  if (config.type === 'schedule' && config.cron) {
    parts.push(`cron: ${config.cron}`);
  } else if ((config.type === 'schedule' || config.type === 'polling') && config.interval_seconds) {
    parts.push(`every ${formatInterval(config.interval_seconds)}`);
  }
  if (config.type === 'polling' && config.endpoint) {
    try {
      const url = new URL(config.endpoint);
      parts.push(url.hostname);
    } catch {
      // intentional: non-critical -- URL parse fallback for display
      parts.push('custom endpoint');
    }
  }
  if (config.type === 'webhook') {
    parts.push('webhook listener');
  }
  if (config.type === 'event_listener' && config.listen_event_type) {
    parts.push(config.listen_event_type);
    if (config.source_filter) {
      parts.push(`from ${config.source_filter}`);
    }
  }

  return (
    <>
      <Icon className={`w-4 h-4 flex-shrink-0 ${colorClass}`} />
      {catMeta && (
        <span className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded ${catMeta.bgColor} ${catMeta.color} ${catMeta.borderColor} border`}>
          {catMeta.label}
        </span>
      )}
      <span className={`typo-body font-medium ${colorClass}`}>
        {getTriggerTypeLabel(trigger.trigger_type)}
      </span>
      {parts.length > 0 && (
        <span className="typo-body text-foreground truncate">
          {parts.join(' · ')}
        </span>
      )}
    </>
  );
}
