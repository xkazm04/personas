import { useMemo, useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import type { ScheduleEntry } from '../libs/scheduleHelpers';
import {
  type CalendarView,
  type CalendarEvent,
  buildCalendarEvents,
  getWeekRange,
  getMonthRange,
  agentColor,
  detectConflicts,
} from '../libs/calendarHelpers';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { EventTooltip } from './EventTooltip';
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

  const conflicts = useMemo(() => detectConflicts(events), [events]);
  const totalConflicts = conflicts.byHourCell.size + conflicts.byDayCell.size;

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
            {totalConflicts > 0 && (
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-400/70" /> Overlap
              </span>
            )}
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
          conflictsByHourCell={conflicts.byHourCell}
          conflictsByEventId={conflicts.byEventId}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
        />
      ) : (
        <MonthView
          anchor={anchor}
          events={events}
          colorMap={colorMap}
          conflictsByDayCell={conflicts.byDayCell}
          conflictsByEventId={conflicts.byEventId}
          onEventClick={handleEventClick}
          onEventHover={handleEventHover}
        />
      )}

      {/* Tooltip */}
      {hoveredEvent && tooltipPos && (
        <EventTooltip
          event={hoveredEvent}
          pos={tooltipPos}
          conflictGroup={conflicts.byEventId.get(hoveredEvent.id)}
        />
      )}
    </div>
  );
}
