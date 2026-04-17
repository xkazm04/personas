import { EVENT_TYPE_META, DEFAULT_EVENT_META } from './eventTypeMeta';

export function EventTypeChip({ eventType }: { eventType: string }) {
  const meta = EVENT_TYPE_META[eventType] ?? DEFAULT_EVENT_META;
  const { Icon, text, bg, border } = meta;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-card typo-code font-mono border ${bg} ${text} ${border} truncate max-w-full`}
      title={eventType}
    >
      <Icon className="w-3 h-3 flex-shrink-0" />
      {eventType}
    </span>
  );
}
