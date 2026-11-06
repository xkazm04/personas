import { EVENT_TYPE_META, DEFAULT_EVENT_META } from './eventTypeMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * Single-line event-type value: colored provider glyph + the full event type
 * (e.g. "document.edited") on one row. No pill/tag chrome — the column reads
 * as a plain value, not a badge.
 */
export function EventTypeChip({ eventType }: { eventType: string }) {
  const meta = EVENT_TYPE_META[eventType] ?? DEFAULT_EVENT_META;
  const { Icon, text } = meta;

  return (
    <Tooltip content={eventType}><span className="inline-flex items-center gap-2 min-w-0 max-w-full">
      <Icon className={`w-4 h-4 flex-shrink-0 ${text}`} />
      <span className="typo-body text-ink-1 truncate">{eventType}</span>
    </span></Tooltip>
  );
}
