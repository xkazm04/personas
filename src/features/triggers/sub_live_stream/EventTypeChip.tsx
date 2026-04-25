import { EVENT_TYPE_META, DEFAULT_EVENT_META } from './eventTypeMeta';

/**
 * Two-line chip: 16px provider glyph + foreground verb with muted namespace beneath.
 * Falls back to single-line layout when the event type has no "namespace.verb" split.
 */
export function EventTypeChip({ eventType }: { eventType: string }) {
  const meta = EVENT_TYPE_META[eventType] ?? DEFAULT_EVENT_META;
  const { Icon, text, border } = meta;

  const dotIdx = eventType.indexOf('.');
  const hasNamespace = dotIdx > 0 && dotIdx < eventType.length - 1;
  const namespace = hasNamespace ? eventType.slice(0, dotIdx) : null;
  const verb = hasNamespace ? eventType.slice(dotIdx + 1) : eventType;

  return (
    <span
      className={`inline-flex items-center gap-2 px-2 py-1 rounded-input bg-secondary/40 border ${border} ${text} max-w-full`}
      title={eventType}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 ${text}`} />
      <span className="flex flex-col min-w-0 leading-tight">
        <span className="typo-caption font-semibold text-foreground truncate">
          {verb}
        </span>
        {namespace && (
          <span className="typo-caption text-muted-foreground truncate font-mono">
            {namespace}
          </span>
        )}
      </span>
    </span>
  );
}
