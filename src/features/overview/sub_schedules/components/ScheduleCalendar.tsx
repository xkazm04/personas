import { useMemo, useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, Clock, Bot,
} from 'lucide-react';
import type { ScheduleEntry } from '../libs/scheduleHelpers';
import {
  type CalendarView,
  type CalendarEvent,
  buildCalendarEvents,
  buildWeekGrid,
  buildMonthGrid,
  getWeekRange,
  getMonthRange,
  formatHour,
  formatDayHeader,
  weekdayShort,
  isSameDay,
  startOfDay,
  dayKey,
  agentColor,
} from '../libs/calendarHelpers';
interface ScheduleCalendarProps {
  entries: ScheduleEntry[];
  onNavigateToExecution?: (agentId: string) => void;
  onNavigateToTrigger?: (triggerId: string) => void;
}

export default function ScheduleCalendar({
  entries,
  onNavigateToExecution,
  onNavigateToTrigger,
}: ScheduleCalendarProps) {
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [hoveredEvent, setHoveredEvent] = useState<CalendarEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Color map: assign stable colors to agents
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach((e, i) => {
      map.set(e.agent.trigger_id, agentColor(e.agent, i));
    });
    return map;
  }, [entries]);

  const range = useMemo(
    () => view === 'week' ? getWeekRange(anchor) : getMonthRange(anchor),
    [view, anchor],
  );

  const events = useMemo(
    () => buildCalendarEvents(entries, range.start, range.end),
    [entries, range],
  );

  // Navigation
  const navigate = useCallback((dir: -1 | 1) => {
    setAnchor((prev) => {
      const d = new Date(prev);
      if (view === 'week') d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  }, [view]);

  const goToday = useCallback(() => setAnchor(new Date()), []);

  const handleEventClick = useCallback((ev: CalendarEvent) => {
    if (ev.kind === 'projected') {
      onNavigateToTrigger?.(ev.triggerId);
    } else {
      onNavigateToExecution?.(ev.agentId);
    }
  }, [onNavigateToExecution, onNavigateToTrigger]);

  const handleEventHover = useCallback((ev: CalendarEvent | null, e?: React.MouseEvent) => {
    setHoveredEvent(ev);
    if (ev && e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    } else {
      setTooltipPos(null);
    }
  }, []);

  const headerLabel = view === 'week'
    ? `${range.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(range.end.getTime() - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col gap-3">
      {/* Calendar toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg border border-primary/10 hover:bg-secondary/50 text-muted-foreground/70 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate(1)}
            className="p-1.5 rounded-lg border border-primary/10 hover:bg-secondary/50 text-muted-foreground/70 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="px-2.5 py-1 text-xs rounded-lg border border-primary/10 hover:bg-secondary/50 text-muted-foreground/70 transition-colors"
          >
            Today
          </button>
          <span className="typo-heading text-foreground/80 ml-1">
            {headerLabel}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Legend */}
          <div className="flex items-center gap-3 mr-4 text-[10px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400/60" /> Projected
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400/70" /> Success
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="w-3 h-3 text-red-400/70" /> Failed
            </span>
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg border border-primary/15 overflow-hidden">
            <button
              onClick={() => setView('week')}
              className={`px-2.5 py-1 text-xs transition-colors ${
                view === 'week'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/60 hover:text-foreground/70'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-2.5 py-1 text-xs transition-colors ${
                view === 'month'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/60 hover:text-foreground/70'
              }`}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      {view === 'week' ? (
        <WeekView
          anchor={anchor}
          events={events}
          colorMap={colorMap}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
        />
      ) : (
        <MonthView
          anchor={anchor}
          events={events}
          colorMap={colorMap}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
        />
      )}

      {/* Tooltip */}
      {hoveredEvent && tooltipPos && (
        <EventTooltip event={hoveredEvent} pos={tooltipPos} />
      )}
    </div>
  );
}

// -- Week View ---------------------------------------------------------------

function WeekView({
  anchor,
  events,
  colorMap,
  onEventClick,
  onEventHover,
}: {
  anchor: Date;
  events: CalendarEvent[];
  colorMap: Map<string, string>;
  onEventClick: (ev: CalendarEvent) => void;
  onEventHover: (ev: CalendarEvent | null, e?: React.MouseEvent) => void;
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
          <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-primary/5 min-h-[40px]">
            {/* Hour label */}
            <div className="px-2 py-1 text-[10px] text-muted-foreground/40 text-right pr-3 pt-1.5">
              {formatHour(hour)}
            </div>

            {/* Day cells */}
            {days.map((day) => {
              const key = dayKey(day);
              const slot = hourSlots.get(key)?.[hour];
              const isNow = isSameDay(day, today) && hour === nowHour;

              return (
                <div
                  key={`${key}-${hour}`}
                  className={`border-l border-primary/5 px-0.5 py-0.5 relative ${
                    isNow ? 'bg-blue-500/[0.04]' : ''
                  }`}
                >
                  {isNow && (
                    <div className="absolute top-0 left-0 right-0 h-px bg-blue-400/40" />
                  )}
                  <div className="flex flex-wrap gap-0.5">
                    {slot?.events.map((ev) => (
                      <EventBlock
                        key={ev.id}
                        event={ev}
                        color={colorMap.get(ev.triggerId) || '#3B82F6'}
                        compact={false}
                        onClick={() => onEventClick(ev)}
                        onHover={onEventHover}
                      />
                    ))}
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

// -- Month View --------------------------------------------------------------

function MonthView({
  anchor,
  events,
  colorMap,
  onEventClick,
  onEventHover,
}: {
  anchor: Date;
  events: CalendarEvent[];
  colorMap: Map<string, string>;
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

            return (
              <div
                key={day.date.toISOString()}
                className={`min-h-[80px] px-1 py-1 border-l border-primary/5 first:border-l-0 transition-colors ${
                  day.isToday
                    ? 'bg-blue-500/[0.04]'
                    : day.isCurrentMonth
                      ? 'bg-transparent'
                      : 'bg-primary/[0.01] opacity-50'
                }`}
              >
                {/* Day number */}
                <div className={`text-xs mb-0.5 ${
                  day.isToday
                    ? 'text-blue-400 font-bold'
                    : day.isCurrentMonth
                      ? 'text-muted-foreground/60'
                      : 'text-muted-foreground/30'
                }`}>
                  {day.isToday ? (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20">
                      {day.date.getDate()}
                    </span>
                  ) : (
                    day.date.getDate()
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

// -- Event Block (colored bar) -----------------------------------------------

function EventBlock({
  event,
  color,
  compact,
  onClick,
  onHover,
}: {
  event: CalendarEvent;
  color: string;
  compact: boolean;
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
    : `${color}20`;

  const borderColor = event.kind === 'past-failure'
    ? 'rgba(239, 68, 68, 0.4)'
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

// -- Tooltip -----------------------------------------------------------------

function EventTooltip({ event, pos }: { event: CalendarEvent; pos: { x: number; y: number } }) {
  return (
    <div
      className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg bg-popover border border-primary/15 shadow-xl text-xs max-w-[220px]"
      style={{
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {event.agentIcon ? (
          <span>{event.agentIcon}</span>
        ) : (
          <Bot className="w-3.5 h-3.5 text-muted-foreground/60" />
        )}
        <span className="font-medium text-foreground/90 truncate">{event.agentName}</span>
      </div>
      <div className="text-muted-foreground/60 space-y-0.5">
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
          {event.kind === 'projected' && <span className="text-blue-400">Scheduled</span>}
          {event.kind === 'past-success' && <span className="text-emerald-400">Completed</span>}
          {event.kind === 'past-failure' && <span className="text-red-400">Failed</span>}
        </div>
      </div>
    </div>
  );
}
