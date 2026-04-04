import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Plus, GripVertical } from 'lucide-react';
import type { CalendarEvent, ConflictGroup } from '../libs/calendarHelpers';
import {
  buildWeekGrid,
  formatHour,
  isSameDay,
  startOfDay,
  dayKey,
} from '../libs/calendarHelpers';
import { EventBlock } from './EventBlock';

const BUSINESS_START = 6;
const BUSINESS_END = 22; // 10 PM

/**
 * Variant B: "Comfort Calendar" - Google Calendar-inspired
 *
 * - Business hours (6 AM - 10 PM) by default, "Show full day" toggle
 * - Larger 56px rows for readability
 * - Events as rounded cards with persona icon, name, and time
 * - Half-hour alternating row backgrounds (subtle zebra striping)
 * - "Now" indicator: pill on time gutter + thin line across grid
 * - Drag-handle dots on events (visual only)
 * - Day column headers with date number + weekday name below
 * - Empty slots show subtle "+" icon on hover
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
  const [showFullDay, setShowFullDay] = useState(false);

  const { days, hourSlots } = useMemo(
    () => buildWeekGrid(anchor, events),
    [anchor, events],
  );

  const today = startOfDay(new Date());
  const now = new Date();
  const nowHour = now.getHours();
  const nowMinutes = now.getMinutes();

  const visibleHours = useMemo(() => {
    if (showFullDay) return Array.from({ length: 24 }, (_, i) => i);
    const result: number[] = [];
    for (let h = BUSINESS_START; h <= BUSINESS_END; h++) result.push(h);
    return result;
  }, [showFullDay]);

  const nowFraction = nowMinutes / 60;

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-primary/10 bg-primary/[0.02]">
        {/* Toggle corner */}
        <div className="px-1 py-2 flex items-center justify-center">
          <button
            onClick={() => setShowFullDay(!showFullDay)}
            className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors flex items-center gap-0.5 cursor-pointer"
            title={showFullDay ? 'Show business hours' : 'Show full day'}
          >
            {showFullDay ? (
              <>
                <ChevronUp className="w-3 h-3" />
                <span>Less</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                <span>24h</span>
              </>
            )}
          </button>
        </div>

        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`px-2 py-2 text-center border-l border-primary/10 ${
                isToday ? 'bg-blue-500/[0.05]' : ''
              }`}
            >
              {/* Date number prominent */}
              <div
                className={`text-lg font-semibold leading-tight ${
                  isToday
                    ? 'text-blue-400'
                    : 'text-foreground/80'
                }`}
              >
                {isToday ? (
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/20 text-blue-400">
                    {day.getDate()}
                  </span>
                ) : (
                  day.getDate()
                )}
              </div>
              {/* Weekday name below */}
              <div className={`text-[10px] mt-0.5 ${isToday ? 'text-blue-400/70' : 'text-muted-foreground/50'}`}>
                {day.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour rows */}
      <div className="max-h-[600px] overflow-y-auto">
        {visibleHours.map((hour, hourIdx) => {
          const isNowHour = nowHour === hour;
          // Zebra striping: alternate every row
          const isEvenRow = hourIdx % 2 === 0;

          return (
            <div
              key={hour}
              className={`grid grid-cols-[64px_repeat(7,1fr)] border-b border-primary/[0.06] relative ${
                isEvenRow ? 'bg-primary/[0.01]' : ''
              }`}
              style={{ minHeight: '56px' }}
            >
              {/* Hour label gutter */}
              <div className="px-1 py-1 text-right pr-3 pt-2 border-r border-primary/10 relative">
                {isNowHour && isSameDay(days[0]!, today) ? (
                  /* Now pill indicator */
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500 text-white font-medium">
                      {formatHour(hour)}
                    </span>
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground/40">
                    {formatHour(hour)}
                  </span>
                )}
              </div>

              {/* Day cells */}
              {days.map((day) => {
                const key = dayKey(day);
                const slot = hourSlots.get(key)?.[hour];
                const isNowCell = isSameDay(day, today) && isNowHour;
                const cellConflictKey = `${key}-${hour}`;
                const cellConflictCount = conflictsByHourCell.get(cellConflictKey) ?? 0;
                const isEmpty = !slot || slot.events.length === 0;

                return (
                  <div
                    key={`${key}-${hour}`}
                    className={`border-l border-primary/[0.06] px-1 py-1 relative group ${
                      isNowCell ? 'bg-blue-500/[0.03]' : ''
                    } ${cellConflictCount > 0 ? 'bg-amber-500/[0.04]' : ''}`}
                  >
                    {/* Now line */}
                    {isNowCell && (
                      <div
                        className="absolute left-0 right-0 h-px bg-blue-400/50 z-10 pointer-events-none"
                        style={{ top: `${nowFraction * 100}%` }}
                      />
                    )}

                    {/* Conflict badge */}
                    {cellConflictCount > 0 && (
                      <div
                        className="absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 z-10"
                        title={`${cellConflictCount} agents overlap within 5 minutes`}
                      >
                        <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                        <span className="text-[8px] font-bold text-amber-400">{cellConflictCount}</span>
                      </div>
                    )}

                    {/* Events as rounded cards */}
                    <div className="flex flex-col gap-1">
                      {slot?.events.slice(0, 3).map((ev) => {
                        const color = colorMap.get(ev.triggerId) || '#3B82F6';
                        const hasConflict = conflictsByEventId.has(ev.id);

                        return (
                          <div key={ev.id} className="flex items-center gap-0.5">
                            {/* Drag handle dots (visual only) */}
                            <GripVertical className="w-3 h-3 text-muted-foreground/20 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
                            <div className="flex-1 min-w-0">
                              <EventBlock
                                event={ev}
                                color={color}
                                compact={false}
                                hasConflict={hasConflict}
                                onClick={() => onEventClick(ev)}
                                onHover={onEventHover}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {(slot?.events.length ?? 0) > 3 && (
                        <span className="text-[9px] text-muted-foreground/50 pl-4">
                          +{slot!.events.length - 3} more
                        </span>
                      )}
                    </div>

                    {/* Empty slot "+" affordance on hover */}
                    {isEmpty && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <Plus className="w-4 h-4 text-muted-foreground/20" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
