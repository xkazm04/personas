import { useTranslation } from '@/i18n/useTranslation';
import { Clock, AlertTriangle } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { CalendarEvent, ConflictGroup } from '../libs/calendarHelpers';

export function EventTooltip({
  event,
  pos,
  conflictGroup,
}: {
  event: CalendarEvent;
  pos: { x: number; y: number };
  conflictGroup?: ConflictGroup;
}) {
  // Other agents in the same conflict window (excluding the current one)
  const { t } = useTranslation();
  const st = t.schedules;
  const otherConflicts = conflictGroup
    ? [...new Set(conflictGroup.events.filter((e) => e.triggerId !== event.triggerId).map((e) => e.agentName))]
    : [];

  return (
    <div
      className="fixed z-50 pointer-events-none px-3 py-2 rounded-card bg-popover border border-primary/15 shadow-elevation-3 text-xs max-w-[240px]"
      style={{
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <PersonaIcon icon={event.agentIcon} color={event.agentColor ?? null} display="pop" frameSize="lg" />
        <span className="font-medium text-foreground/90 truncate">{event.agentName}</span>
      </div>
      <div className="text-foreground space-y-0.5">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {event.time.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
        <div className="flex items-center gap-1 capitalize">
          {event.kind === 'projected' && <span className="text-blue-400">{st.scheduled}</span>}
          {event.kind === 'past-success' && <span className="text-emerald-400">Completed</span>}
          {event.kind === 'past-failure' && <span className="text-red-400">Failed</span>}
        </div>
        {otherConflicts.length > 0 && (
          <div className="flex items-start gap-1 mt-1 pt-1 border-t border-primary/10 text-amber-400/90">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              Overlaps with {otherConflicts.slice(0, 3).join(', ')}
              {otherConflicts.length > 3 && ` +${otherConflicts.length - 3} more`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
