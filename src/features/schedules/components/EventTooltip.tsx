/**
 * The body of a calendar chip's disclosure: who fires, exactly when, what the
 * slot's verification state is, and - when the slot overlaps others - which
 * agents share the window.
 *
 * This used to also own its own `fixed` positioning and had zero consumers, so
 * nothing on the calendar was labelled at all. Positioning, flipping, delay,
 * focus and the portal now come from the shared `display/Tooltip`; this
 * renders content only, which is what let it actually be mounted (a chip sets
 * `hover:scale-[1.02]`, and that transform makes an inline `position: fixed`
 * child resolve against the chip instead of the viewport).
 */
import { useTranslation } from '@/i18n/useTranslation';
import { Clock, AlertTriangle } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import type { CalendarEvent, ConflictGroup } from '../libs/calendarHelpers';

/** How many overlap partners to name before collapsing into a "+N more". */
const MAX_NAMED_PARTNERS = 3;

export function EventTooltipContent({
  event,
  conflictGroup,
}: {
  event: CalendarEvent;
  conflictGroup?: ConflictGroup;
}) {
  const { t } = useTranslation();
  const st = t.schedules;
  // Other agents in the same conflict window (excluding the current one)
  const otherConflicts = conflictGroup
    ? [...new Set(conflictGroup.events.filter((e) => e.triggerId !== event.triggerId).map((e) => e.agentName))]
    : [];

  return (
    <div className="max-w-[240px]" data-testid="event-tooltip">
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
          {event.kind === 'past-success' && <span className="text-emerald-400">{st.success}</span>}
          {event.kind === 'past-failure' && <span className="text-red-400">{st.failed}</span>}
          {event.kind === 'past-unknown' && <span className="text-foreground">{st.unverified}</span>}
        </div>
        {event.kind === 'past-unknown' && (
          <div className="text-foreground leading-snug normal-case">{st.unverified_tooltip}</div>
        )}
        {otherConflicts.length > 0 && (
          <div className="flex items-start gap-1 mt-1 pt-1 border-t border-primary/10 text-amber-400/90">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              {st.overlaps_with} {otherConflicts.slice(0, MAX_NAMED_PARTNERS).join(', ')}
              {otherConflicts.length > MAX_NAMED_PARTNERS && ` +${otherConflicts.length - MAX_NAMED_PARTNERS}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
