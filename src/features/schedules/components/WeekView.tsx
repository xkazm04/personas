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
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-primary/10 bg-primary/[0.02]">
        <div className="px-2 py-2 text-[10px] text-muted-foreground/40" />
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`px-2 py-2 text-center typo-caption border-l border-primary/10 ${
                isToday ? 'text-blue-400' : 'text-muted-foreground/70'
              }`}
            >
              {formatDayHeader(day, 'week')}
              {isToday && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />}
            </div>
          );
        })}
      </div>

      {/* Hour rows */}
      <div className="max-h-[520px] overflow-y-auto">
        {activeHours.map((hour) => (
          <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-primary/5 min-h-[44px]">
            {/* Hour label */}
            <div className="px-2 py-1 text-[10px] text-muted-foreground/40 text-right pr-3 pt-1.5">
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
                  className={`border-l border-primary/5 px-0.5 py-0.5 relative ${
                    isNow ? 'bg-blue-500/[0.04]' : ''
                  } ${cellConflictCount > 0 ? 'bg-amber-500/[0.06]' : ''}`}
                >
                  {isNow && (
                    <div className="absolute top-0 left-0 right-0 h-px bg-blue-400/40" />
                  )}
                  {cellConflictCount > 0 && (
                    <div
                      className="absolute top-0.5 right-0.5 flex items-center gap-0.5 px-1 py-px rounded-full bg-amber-500/20 border border-amber-500/30 z-10"
                      title={`${cellConflictCount} agents overlap within 5 minutes`}
                    >
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                      <span className="text-[8px] font-bold text-amber-400">{cellConflictCount}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {slot?.events.slice(0, 3).map((ev) => (
                      <EventBlock
                        key={ev.id}
                        event={ev}
                        color={colorMap.get(ev.triggerId) || '#3B82F6'}
                        compact={false}
                        hasConflict={conflictsByEventId.has(ev.id)}
                        onClick={() => onEventClick(ev)}
                      />
                    ))}
                    {(slot?.events.length ?? 0) > 3 && (
                      <span className="text-[9px] text-muted-foreground/50 pl-1">+{slot!.events.length - 3} more</span>
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
