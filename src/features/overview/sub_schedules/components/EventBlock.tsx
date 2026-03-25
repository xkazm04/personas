import { Bot, XCircle, CheckCircle2 } from 'lucide-react';
import type { CalendarEvent } from '../libs/calendarHelpers';

export function EventBlock({
  event,
  color,
  compact,
  hasConflict,
  onClick,
  onHover,
}: {
  event: CalendarEvent;
  color: string;
  compact: boolean;
  hasConflict?: boolean;
  onClick: () => void;
  onHover: (ev: CalendarEvent | null, e?: React.MouseEvent) => void;
}) {
  const kindStyles = {
    projected: { borderStyle: '2px solid', opacity: 0.7 },
    'past-success': { borderStyle: '2px solid', opacity: 1 },
    'past-failure': { borderStyle: '2px solid', opacity: 1 },
  };

  const bgColor = event.kind === 'past-failure'
    ? 'rgba(239, 68, 68, 0.15)'
    : hasConflict
      ? 'rgba(245, 158, 11, 0.12)'
      : `${color}20`;

  const borderColor = event.kind === 'past-failure'
    ? 'rgba(239, 68, 68, 0.4)'
    : hasConflict
      ? 'rgba(245, 158, 11, 0.5)'
      : `${color}50`;

  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => onHover(event, e)}
      onMouseLeave={() => onHover(null)}
      className={`flex items-center gap-1 rounded text-left transition-all hover:scale-[1.02] hover:shadow-sm cursor-pointer ${
        compact ? 'px-1 py-px text-[9px] w-full' : 'px-1.5 py-0.5 text-[10px]'
      }`}
      style={{
        backgroundColor: bgColor,
        borderLeft: `${kindStyles[event.kind].borderStyle} ${borderColor}`,
        opacity: kindStyles[event.kind].opacity,
      }}
    >
      {event.agentIcon ? (
        <span className="shrink-0 text-[10px]">{event.agentIcon}</span>
      ) : (
        <Bot className="w-2.5 h-2.5 shrink-0" style={{ color }} />
      )}
      {compact ? (
        <span className="truncate" style={{ color }}>{event.agentName}</span>
      ) : (
        <>
          <span className="truncate font-medium" style={{ color }}>{event.agentName}</span>
          <span className="text-muted-foreground/50 shrink-0 ml-auto">
            {event.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        </>
      )}
      {event.kind === 'past-failure' && (
        <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0" />
      )}
      {event.kind === 'past-success' && (
        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400/60 shrink-0" />
      )}
    </button>
  );
}
