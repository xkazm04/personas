import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CalendarEvent, ConflictGroup } from '../libs/calendarHelpers';
import { buildMonthGrid, weekdayShort, dayKey } from '../libs/calendarHelpers';
import { EventBlock } from './EventBlock';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

export function MonthView({
  anchor,
  events,
  colorMap,
  conflictsByDayCell,
  conflictsByEventId,
  onEventClick,
}: {
  anchor: Date;
  events: CalendarEvent[];
  colorMap: Map<string, string>;
  conflictsByDayCell: Map<string, number>;
  conflictsByEventId: Map<string, ConflictGroup>;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const days = useMemo(() => buildMonthGrid(anchor, events), [anchor, events]);

  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="border border-hair rounded-modal overflow-hidden">
      {/* Weekday headers */}
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-hair bg-primary/[0.02]">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="px-2 py-1.5 text-center typo-eyebrow text-ink-1">
            {weekdayShort(i)}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-hair last:border-b-0">
          {week.map((day) => {
            const MAX_VISIBLE = 3;
            const visibleEvents = day.events.slice(0, MAX_VISIBLE);
            const overflow = day.events.length - MAX_VISIBLE;
            const dKey = dayKey(day.date);
            const dayConflictCount = conflictsByDayCell.get(dKey) ?? 0;

            return (
              <div
                key={day.date.toISOString()}
                className={`min-h-[80px] min-w-0 px-1 py-1 border-l border-hair first:border-l-0 transition-colors relative ${
                  day.isToday
                    ? 'bg-status-info/[0.04]'
                    : dayConflictCount > 0
                      ? 'bg-status-warning/[0.04]'
                      : day.isCurrentMonth
                        ? 'bg-transparent'
                        : 'bg-primary/[0.01] opacity-50'
                }`}
              >
                {/* Day number + conflict badge */}
                <div className={`flex items-center justify-between typo-caption mb-0.5 ${
                  day.isToday
                    ? 'text-status-info'
                    : day.isCurrentMonth
                      ? 'text-ink-1'
                      : 'text-ink-1'
                }`}>
                  <span>
                    {day.isToday ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-status-info/20">
                        {day.date.getDate()}
                      </span>
                    ) : (
                      day.date.getDate()
                    )}
                  </span>
                  {dayConflictCount > 0 && (
                    <Tooltip content={`${dayConflictCount} overlapping executions`}><span
                      className="flex items-center gap-0.5 px-1 py-px rounded-full bg-status-warning/20 border border-status-warning/30">
                      <AlertTriangle className="w-2.5 h-2.5 text-status-warning" />
                      <span className="typo-caption text-status-warning">{dayConflictCount}</span>
                    </span></Tooltip>
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
                      conflictGroup={conflictsByEventId.get(ev.id)}
                      onClick={() => onEventClick(ev)}
                    />
                  ))}
                  {overflow > 0 && (
                    <span className="typo-caption text-ink-2 pl-1">
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
