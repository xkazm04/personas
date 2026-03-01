import type { DbPersonaTrigger } from '@/lib/types/types';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig } from '@/lib/utils/triggerConstants';
import { formatInterval } from '@/lib/utils/formatters';

interface TriggerStatusSummaryProps {
  trigger: DbPersonaTrigger;
}

/** Shared type icon + config badge summary for collapsed trigger rows and list overview. */
export function TriggerStatusSummary({ trigger }: TriggerStatusSummaryProps) {
  const meta = TRIGGER_TYPE_META[trigger.trigger_type] || DEFAULT_TRIGGER_META;
  const Icon = meta.Icon;
  const colorClass = meta.color;
  const config = parseTriggerConfig(trigger.trigger_type, trigger.config);

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
      <span className={`text-sm font-medium ${colorClass}`}>
        {trigger.trigger_type === 'event_listener' ? 'Event Listener' : trigger.trigger_type.charAt(0).toUpperCase() + trigger.trigger_type.slice(1)}
      </span>
      {parts.length > 0 && (
        <span className="text-sm text-muted-foreground/35 truncate">
          {parts.join(' · ')}
        </span>
      )}
    </>
  );
}
