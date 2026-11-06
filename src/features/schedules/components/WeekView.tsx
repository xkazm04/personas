import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CalendarEvent, ConflictGroup } from '../libs/calendarHelpers';
import {
  buildWeekGrid,
  formatHour,
  formatDayHeader,
  isSameDay,
  startOfDay,
  dayKey,
} from '../libs/calendarHelpers';
import { EventBlock } from './EventBlock';

export function WeekView({
  anchor,
  events,
  colorMap,
  conflictsByHourCell,
  conflictsByEventId,
  onEventClick,
}: {
  anchor: Date;
  events: CalendarEvent[];
  colorMap: Map<string, string>;
  conflictsByHourCell: Map<string, number>;
  conflictsByEventId: Map<string, ConflictGroup>;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const { days, hourSlots } = useMemo(
    () => buildWeekGrid(anchor, events),
    [anchor, events],
  );

  const today = startOfDay(new Date());
  const nowHour = new Date().getHours();

  // Only show hours that have events, plus padding, to avoid a huge 24-row grid
  const activeHours = useMemo(() => {
    const hoursWithEvents = new Set<number>();
    for (const slots of hourSlots.values()) {
      for (const slot of slots) {
        if (slot.events.length > 0) hoursWithEvents.add(slot.hour);
      }
    }
    if (hoursWithEvents.size === 0) {
      // Show business hours by default
      return Array.from({ length: 14 }, (_, i) => i + 6); // 6AM-7PM
    }
    const min = Math.max(0, Math.min(...hoursWithEvents) - 1);
    const max = Math.min(23, Math.max(...hoursWithEvents) + 1);
    const result: number[] = [];
    for (let h = min; h <= max; h++) result.push(h);
    return result;
  }, [hourSlots]);

  return (
    <div className="border border-hair rounded-modal overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b border-hair bg-primary/[0.02]">
        <div className="px-2 py-2 typo-caption text-ink-2" />
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`px-2 py-2 text-center typo-caption border-l border-hair ${
                isToday ? 'text-status-info' : 'text-ink-1'
              }`}
            >
              {formatDayHeader(day, 'week')}
              {isToday && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-status-info inline-block" />}
            </div>
          );
        })}
      </div>

      {/* Hour rows */}
      <div className="max-h-[624px] overflow-y-auto">
        {activeHours.map((hour) => (
          <div key={hour} className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b border-hair min-h-[44px]">
            {/* Hour label */}
            <div className="px-2 py-1 typo-caption text-ink-2 text-right pr-3 pt-1.5">
              {formatHour(hour)}
            </div>

            {/* Day cells */}
            {days.map((day) => {
              const key = dayKey(day);
              const slot = hourSlots.get(key)?.[hour];
              const isNow = isSameDay(day, today) && hour === nowHour;
              const cellConflictKey = `${key}-${hour}`;
              const cellConflictCount = conflictsByHourCell.get(cellConflictKey) ?? 0;

              return (
                <div
                  key={`${key}-${hour}`}
                  className={`border-l border-hair px-0.5 py-0.5 relative min-w-0 ${
                    isNow ? 'bg-status-info/[0.04]' : ''
                  } ${cellConflictCount > 0 ? 'bg-status-warning/[0.06]' : ''}`}
                >
                  {isNow && (
                    <div className="absolute top-0 left-0 right-0 h-px bg-status-info/40" />
                  )}
                  {cellConflictCount > 0 && (
                    <div
                      className="absolute top-0.5 right-0.5 flex items-center gap-0.5 px-1 py-px rounded-full bg-status-warning/20 border border-status-warning/30 z-10"
                      title={`${cellConflictCount} agents overlap within 5 minutes`}
                    >
                      <AlertTriangle className="w-2.5 h-2.5 text-status-warning" />
                      <span className="typo-caption text-status-warning">{cellConflictCount}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {slot?.events.slice(0, 3).map((ev) => (
                      <EventBlock
                        key={ev.id}
                        event={ev}
                        color={colorMap.get(ev.triggerId) || '#3B82F6'}
                        compact={false}
                        conflictGroup={conflictsByEventId.get(ev.id)}
                        onClick={() => onEventClick(ev)}
                      />
                    ))}
                    {(slot?.events.length ?? 0) > 3 && (
                      <span className="typo-caption text-ink-2 pl-1">+{slot!.events.length - 3} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
