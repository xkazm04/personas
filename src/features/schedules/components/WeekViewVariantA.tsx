import { useMemo, useRef } from 'react';
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
// EventBlock is available for extended use but this variant renders inline bars
// import { EventBlock } from './EventBlock';

/**
 * Variant A: "Dense Timeline" - Maximized information density
 *
 * - Full 24h grid always visible with compact 36px rows
 * - Hour labels on left gutter, half-hour dashed grid lines
 * - Red horizontal line for current time spanning full width
 * - Events as colored bars, side-by-side stacking in same slot
 * - Mini density stats per column header ("12 events today")
 * - Sticky day headers and hour column while scrolling
 */
export function WeekView({
  anchor,
  events,
  colorMap,
  conflictsByHourCell,
  conflictsByEventId,
  onEventClick,
  onEventHover,
}: {
  anchor: Date;
  events: CalendarEvent[];
  colorMap: Map<string, string>;
  conflictsByHourCell: Map<string, number>;
  conflictsByEventId: Map<string, ConflictGroup>;
  onEventClick: (ev: CalendarEvent) => void;
  onEventHover: (ev: CalendarEvent | null, e?: React.MouseEvent) => void;
}) {
  const { days, hourSlots } = useMemo(
    () => buildWeekGrid(anchor, events),
    [anchor, events],
  );

  const today = startOfDay(new Date());
  const now = new Date();
  const nowHour = now.getHours();
  const nowMinutes = now.getMinutes();
  const scrollRef = useRef<HTMLDivElement>(null);

  // All 24 hours, always
  const allHours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  // Count events per day for density badges
  const eventsPerDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const day of days) {
      const key = dayKey(day);
      const slots = hourSlots.get(key);
      let count = 0;
      if (slots) {
        for (const slot of slots) {
          count += slot.events.length;
        }
      }
      counts.set(key, count);
    }
    return counts;
  }, [days, hourSlots]);

  // Position of current time line as fraction within its hour row
  const nowFraction = nowMinutes / 60;

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden relative">
      {/* Sticky day headers */}
      <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-primary/10 bg-primary/[0.03] sticky top-0 z-20">
        <div className="px-1 py-1.5 text-[9px] text-muted-foreground/30 border-r border-primary/10" />
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          const key = dayKey(day);
          const count = eventsPerDay.get(key) ?? 0;
          return (
            <div
              key={day.toISOString()}
              className={`px-1 py-1.5 text-center border-l border-primary/10 ${
                isToday ? 'bg-blue-500/[0.06]' : ''
              }`}
            >
              <div className={`text-[10px] font-medium ${isToday ? 'text-blue-400' : 'text-muted-foreground/70'}`}>
                {formatDayHeader(day, 'week')}
                {isToday && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />}
              </div>
              {count > 0 && (
                <div className="mt-0.5">
                  <span className="text-[8px] px-1.5 py-px rounded-full bg-secondary/30 text-muted-foreground/60">
                    {count} event{count !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable grid body */}
      <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
        {allHours.map((hour) => (
          <div key={hour} className="relative">
            {/* Main hour row */}
            <div
              className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-primary/[0.07]"
              style={{ minHeight: '36px' }}
            >
              {/* Sticky hour label */}
              <div className="px-1 py-0.5 text-[9px] text-muted-foreground/40 text-right pr-2 pt-1 border-r border-primary/10 sticky left-0 bg-card-bg z-10">
                {formatHour(hour)}
              </div>

              {/* Day cells */}
              {days.map((day) => {
                const key = dayKey(day);
                const slot = hourSlots.get(key)?.[hour];
                const isNowCell = isSameDay(day, today) && hour === nowHour;
                const cellConflictKey = `${key}-${hour}`;
                const cellConflictCount = conflictsByHourCell.get(cellConflictKey) ?? 0;

                return (
                  <div
                    key={`${key}-${hour}`}
                    className={`border-l border-primary/[0.05] px-0.5 py-px relative ${
                      isNowCell ? 'bg-blue-500/[0.03]' : ''
                    } ${cellConflictCount > 0 ? 'bg-amber-500/[0.05]' : ''}`}
                  >
                    {/* Current time red line */}
                    {isNowCell && (
                      <div
                        className="absolute left-0 right-0 h-[2px] bg-red-500 z-10 pointer-events-none"
                        style={{ top: `${nowFraction * 100}%` }}
                      >
                        <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-500" />
                      </div>
                    )}

                    {/* Conflict badge */}
                    {cellConflictCount > 0 && (
                      <div
                        className="absolute top-0 right-0 flex items-center gap-0.5 px-0.5 py-px rounded-bl bg-amber-500/20 border-b border-l border-amber-500/30 z-10"
                        title={`${cellConflictCount} agents overlap within 5 minutes`}
                      >
                        <AlertTriangle className="w-2 h-2 text-amber-400" />
                        <span className="text-[7px] font-bold text-amber-400">{cellConflictCount}</span>
                      </div>
                    )}

                    {/* Events: side-by-side layout */}
                    <div className="flex flex-row gap-px overflow-hidden h-full items-start">
                      {slot?.events.slice(0, 5).map((ev) => {
                        const color = colorMap.get(ev.triggerId) || '#3B82F6';
                        const hasConflict = conflictsByEventId.has(ev.id);
                        const kindOpacity = ev.kind === 'projected' ? 0.6 : 1;
                        const bgColor = ev.kind === 'past-failure'
                          ? 'rgba(239, 68, 68, 0.25)'
                          : hasConflict
                            ? 'rgba(245, 158, 11, 0.2)'
                            : `${color}30`;

                        return (
                          <button
                            key={ev.id}
                            onClick={() => onEventClick(ev)}
                            onMouseEnter={(e) => onEventHover(ev, e)}
                            onMouseLeave={() => onEventHover(null)}
                            className="flex-1 min-w-0 rounded-sm cursor-pointer transition-all hover:brightness-125 hover:scale-y-110"
                            style={{
                              backgroundColor: bgColor,
                              borderLeft: `2px solid ${color}60`,
                              opacity: kindOpacity,
                              height: '100%',
                              minHeight: '28px',
                            }}
                            title={`${ev.agentName} - ${ev.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
                          >
                            <span
                              className="block truncate text-[8px] font-medium px-0.5 pt-0.5 leading-tight"
                              style={{ color }}
                            >
                              {ev.agentName}
                            </span>
                            <span className="block text-[7px] text-muted-foreground/40 px-0.5 leading-tight">
                              {ev.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </button>
                        );
                      })}
                      {(slot?.events.length ?? 0) > 5 && (
                        <span className="text-[7px] text-muted-foreground/40 self-center px-0.5 shrink-0">
                          +{slot!.events.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Half-hour dashed line */}
            <div className="grid grid-cols-[52px_repeat(7,1fr)] absolute top-1/2 left-0 right-0 pointer-events-none">
              <div />
              {days.map((day) => (
                <div
                  key={`half-${day.toISOString()}`}
                  className="border-t border-dashed border-primary/[0.05] border-l border-l-primary/[0.05]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
