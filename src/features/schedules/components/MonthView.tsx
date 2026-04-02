import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CalendarEvent, ConflictGroup } from '../libs/calendarHelpers';
import { buildMonthGrid, weekdayShort, dayKey } from '../libs/calendarHelpers';
import { EventBlock } from './EventBlock';

export function MonthView({
  anchor,
  events,
  colorMap,
  conflictsByDayCell,
  conflictsByEventId,
  onEventClick,
  onEventHover,
}: {
  anchor: Date;
  events: CalendarEvent[];
  colorMap: Map<string, string>;
  conflictsByDayCell: Map<string, number>;
  conflictsByEventId: Map<string, ConflictGroup>;
  onEventClick: (ev: CalendarEvent) => void;
  onEventHover: (ev: CalendarEvent | null, e?: React.MouseEvent) => void;
}) {
  const days = useMemo(() => buildMonthGrid(anchor, events), [anchor, events]);

  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-primary/10 bg-primary/[0.02]">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="px-2 py-1.5 text-center text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
            {weekdayShort(i)}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-primary/5 last:border-b-0">
          {week.map((day) => {
            const MAX_VISIBLE = 3;
            const visibleEvents = day.events.slice(0, MAX_VISIBLE);
            const overflow = day.events.length - MAX_VISIBLE;
            const dKey = dayKey(day.date);
            const dayConflictCount = conflictsByDayCell.get(dKey) ?? 0;

            return (
              <div
                key={day.date.toISOString()}
                className={`min-h-[80px] px-1 py-1 border-l border-primary/5 first:border-l-0 transition-colors relative ${
                  day.isToday
                    ? 'bg-blue-500/[0.04]'
                    : dayConflictCount > 0
                      ? 'bg-amber-500/[0.04]'
                      : day.isCurrentMonth
                        ? 'bg-transparent'
                        : 'bg-primary/[0.01] opacity-50'
                }`}
              >
                {/* Day number + conflict badge */}
                <div className={`flex items-center justify-between text-xs mb-0.5 ${
                  day.isToday
                    ? 'text-blue-400 font-bold'
                    : day.isCurrentMonth
                      ? 'text-muted-foreground/60'
                      : 'text-muted-foreground/30'
                }`}>
                  <span>
                    {day.isToday ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20">
                        {day.date.getDate()}
                      </span>
                    ) : (
                      day.date.getDate()
                    )}
                  </span>
                  {dayConflictCount > 0 && (
                    <span
                      className="flex items-center gap-0.5 px-1 py-px rounded-full bg-amber-500/20 border border-amber-500/30"
                      title={`${dayConflictCount} overlapping executions`}
                    >
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                      <span className="text-[8px] font-bold text-amber-400">{dayConflictCount}</span>
                    </span>
                  )}
                </div>

                {/* Events */}
                <div className="flex flex-col gap-px">
                  {visibleEvents.map((ev) => (
                    <EventBlock
                      key={ev.id}
                      event={ev}
                      color={colorMap.get(ev.triggerId) || '#3B82F6'}
                      compact
                      hasConflict={conflictsByEventId.has(ev.id)}
                      onClick={() => onEventClick(ev)}
                      onHover={onEventHover}
                    />
                  ))}
                  {overflow > 0 && (
                    <span className="text-[9px] text-muted-foreground/40 pl-1">
                      +{overflow} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
