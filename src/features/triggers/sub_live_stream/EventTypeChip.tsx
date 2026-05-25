import { EVENT_TYPE_META, DEFAULT_EVENT_META } from './eventTypeMeta';

/**
 * Single-line event-type value: colored provider glyph + the full event type
 * (e.g. "document.edited") on one row. No pill/tag chrome — the column reads
 * as a plain value, not a badge.
 */
export function EventTypeChip({ eventType }: { eventType: string }) {
  const meta = EVENT_TYPE_META[eventType] ?? DEFAULT_EVENT_META;
  const { Icon, text } = meta;

  return (
    <span className="inline-flex items-center gap-2 min-w-0 max-w-full" title={eventType}>
      <Icon className={`w-4 h-4 flex-shrink-0 ${text}`} />
      <span className="typo-body text-foreground truncate">{eventType}</span>
    </span>
  );
}
