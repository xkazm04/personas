import { useTranslation } from '@/i18n/useTranslation';
import { useMemo, useState, useCallback } from 'react';
import { Clock } from 'lucide-react';
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

/**
 * Variant C: "Compact Heatmap" - Focus on density and patterns
 *
 * - 48 rows (30-minute slots) with 24px height
 * - Heatmap cells: color intensity = event count, hue = dominant agent color
 * - Hover popover shows event list for that slot
 * - Current time shown as bright dot/marker
 * - Day headers show total event count badge
 * - Below grid: compact "Next 5 upcoming" list
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
  const nowHalfSlot = nowHour * 2 + (nowMinutes >= 30 ? 1 : 0);

  // 48 half-hour slots
  const halfHourSlots = useMemo(() => Array.from({ length: 48 }, (_, i) => i), []);

  // Build half-hour slot data: for each day x half-hour, determine events
  const halfHourData = useMemo(() => {
    const data = new Map<string, CalendarEvent[]>();

    for (const day of days) {
      const key = dayKey(day);
      const slots = hourSlots.get(key);
      if (!slots) continue;

      for (let h = 0; h < 24; h++) {
        const hourEvents = slots[h]?.events ?? [];
        // Split events into first half (minute < 30) and second half (minute >= 30)
        const firstHalf = hourEvents.filter((ev) => ev.time.getMinutes() < 30);
        const secondHalf = hourEvents.filter((ev) => ev.time.getMinutes() >= 30);

        data.set(`${key}-${h * 2}`, firstHalf);
        data.set(`${key}-${h * 2 + 1}`, secondHalf);
      }
    }
    return data;
  }, [days, hourSlots]);

  // Events per day count
  const eventsPerDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const day of days) {
      const key = dayKey(day);
      const slots = hourSlots.get(key);
      let count = 0;
      if (slots) {
        for (const slot of slots) count += slot.events.length;
      }
      counts.set(key, count);
    }
    return counts;
  }, [days, hourSlots]);

  // Next 5 upcoming events from now
  const upcomingEvents = useMemo(() => {
    const nowMs = now.getTime();
    return events
      .filter((ev) => ev.time.getTime() > nowMs)
      .sort((a, b) => a.time.getTime() - b.time.getTime())
      .slice(0, 5);
  }, [events, now]);

  // Popover state
  const [popover, setPopover] = useState<{
    cellKey: string;
    events: CalendarEvent[];
    x: number;
    y: number;
  } | null>(null);

  const handleCellHover = useCallback(
    (cellKey: string, cellEvents: CalendarEvent[], e: React.MouseEvent) => {
      if (cellEvents.length === 0) {
        setPopover(null);
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPopover({
        cellKey,
        events: cellEvents,
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    },
    [],
  );

  const handleCellLeave = useCallback(() => {
    setPopover(null);
  }, []);

  /**
   * Compute heatmap cell style based on events in that slot.
   * Returns backgroundColor derived from dominant agent color and event count intensity.
   */
  function cellStyle(cellEvents: CalendarEvent[]): React.CSSProperties {
    if (cellEvents.length === 0) return {};

    // Find dominant agent color (most frequent)
    const colorCounts = new Map<string, number>();
    for (const ev of cellEvents) {
      const c = colorMap.get(ev.triggerId) || '#3B82F6';
      colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
    }
    let dominantColor = '#3B82F6';
    let maxCount = 0;
    for (const [c, count] of colorCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantColor = c;
      }
    }

    // Intensity based on event count: 1 event = light, 2+ = more saturated
    const alpha = Math.min(0.15 + cellEvents.length * 0.12, 0.6);

    return {
      backgroundColor: `${dominantColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`,
    };
  }

  function formatHalfHour(slotIdx: number): string {
    const hour = Math.floor(slotIdx / 2);
    const isHalf = slotIdx % 2 === 1;
    if (isHalf) return '';
    return formatHour(hour);
  }

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[44px_repeat(7,1fr)] border-b border-primary/10 bg-primary/[0.02]">
        <div className="px-1 py-1.5 text-[8px] text-muted-foreground/30" />
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          const key = dayKey(day);
          const count = eventsPerDay.get(key) ?? 0;
          return (
            <div
              key={day.toISOString()}
              className={`px-1 py-1.5 text-center border-l border-primary/10 ${
                isToday ? 'bg-blue-500/[0.05]' : ''
              }`}
            >
              <div className="flex items-center justify-center gap-1">
                <span className={`text-[10px] font-medium ${isToday ? 'text-blue-400' : 'text-muted-foreground/70'}`}>
                  {formatDayHeader(day, 'week')}
                </span>
                {isToday && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />}
                {count > 0 && (
                  <span className="text-[8px] px-1 py-px rounded-full bg-secondary/30 text-muted-foreground/60 font-medium">
                    {count}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Heatmap grid */}
      <div className="max-h-[500px] overflow-y-auto relative">
        {halfHourSlots.map((slotIdx) => {
          const hour = Math.floor(slotIdx / 2);
          const isFullHour = slotIdx % 2 === 0;

          return (
            <div
              key={slotIdx}
              className={`grid grid-cols-[44px_repeat(7,1fr)] ${
                isFullHour ? 'border-t border-primary/[0.06]' : ''
              }`}
              style={{ height: '24px' }}
            >
              {/* Time gutter */}
              <div className="px-1 text-right pr-2 border-r border-primary/10 flex items-center justify-end relative">
                {isFullHour && (
                  <span className="text-[8px] text-muted-foreground/35 leading-none">
                    {formatHalfHour(slotIdx)}
                  </span>
                )}
                {/* Current time bright dot */}
                {slotIdx === nowHalfSlot && (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.6)]" />
                  </div>
                )}
              </div>

              {/* Day cells - heatmap */}
              {days.map((day) => {
                const key = dayKey(day);
                const cellKey = `${key}-${slotIdx}`;
                const cellEvents = halfHourData.get(cellKey) ?? [];
                const isNowSlot = isSameDay(day, today) && slotIdx === nowHalfSlot;

                // Conflict check: use hour-level conflict data
                const cellConflictKey = `${key}-${hour}`;
                const cellConflictCount = conflictsByHourCell.get(cellConflictKey) ?? 0;
                const hasConflicts = cellConflictCount > 0 && cellEvents.length > 0;

                return (
                  <div
                    key={cellKey}
                    className={`border-l border-primary/[0.04] relative transition-colors cursor-default ${
                      isNowSlot ? 'ring-1 ring-inset ring-blue-400/30' : ''
                    }`}
                    style={cellStyle(cellEvents)}
                    onMouseEnter={(e) => handleCellHover(cellKey, cellEvents, e)}
                    onMouseLeave={handleCellLeave}
                  >
                    {/* Conflict indicator */}
                    {hasConflicts && (
                      <div className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-amber-400 z-10" />
                    )}

                    {/* Current time marker */}
                    {isNowSlot && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-blue-400 z-10" />
                    )}

                    {/* Event count text for dense cells */}
                    {cellEvents.length > 1 && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-foreground/60">{cellEvents.length}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Popover */}
        {popover && (
          <div
            className="fixed z-50 bg-card-bg border border-primary/15 rounded-lg shadow-elevation-2 p-2 min-w-[180px] max-w-[260px]"
            style={{
              left: `${popover.x}px`,
              top: `${popover.y - 8}px`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="text-[9px] text-muted-foreground/50 mb-1 font-medium">
              {popover.events.length} event{popover.events.length !== 1 ? 's' : ''} in this slot
            </div>
            <div className="flex flex-col gap-1">
              {popover.events.slice(0, 5).map((ev) => (
                <EventBlock
                  key={ev.id}
                  event={ev}
                  color={colorMap.get(ev.triggerId) || '#3B82F6'}
                  compact
                  hasConflict={conflictsByEventId.has(ev.id)}
                  onClick={() => onEventClick(ev)}
                />
              ))}
              {popover.events.length > 5 && (
                <span className="text-[8px] text-muted-foreground/40">+{popover.events.length - 5} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* "Next 5 upcoming" section */}
      {upcomingEvents.length > 0 && (
        <div className="border-t border-primary/10 px-3 py-2 bg-primary/[0.01]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Clock className="w-3 h-3 text-muted-foreground/40" />
            <span className="text-[10px] font-medium text-muted-foreground/60">Next upcoming</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {upcomingEvents.map((ev) => {
              const color = colorMap.get(ev.triggerId) || '#3B82F6';
              return (
                <button
                  key={ev.id}
                  onClick={() => onEventClick(ev)}
                  onMouseEnter={(e) => onEventHover(ev, e)}
                  onMouseLeave={() => onEventHover(null)}
                  className="flex items-center gap-1.5 text-[10px] hover:bg-secondary/20 rounded px-1 py-0.5 transition-colors cursor-pointer"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-muted-foreground/50 tabular-nums shrink-0">
                    {ev.time.toLocaleDateString(undefined, { weekday: 'short' })}{' '}
                    {ev.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium truncate max-w-[100px]" style={{ color }}>
                    {ev.agentName}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
