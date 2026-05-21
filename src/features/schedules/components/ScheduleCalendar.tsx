import { useMemo, useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, RotateCcw,
} from 'lucide-react';
import type { ScheduleEntry } from '../libs/scheduleHelpers';
import {
  type CalendarView,
  type CalendarEvent,
  getWeekRange,
  getMonthRange,
  agentColor,
  detectConflicts,
} from '../libs/calendarHelpers';
import { useCalendarEvents } from '../libs/useCronPreview';
import { useTranslation } from '@/i18n/useTranslation';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';

// Calendar legend filters — each kind toggles independently. "Overlap" is a
// fourth toggle that, when off, hides events that participate in a conflict
// group. Combining toggles lets the user isolate (e.g. only failures, only
// overlapping projecteds). Default state has all four on so a fresh calendar
// shows everything.
type LegendKind = 'projected' | 'past-success' | 'past-failure' | 'overlap';
const ALL_KINDS: LegendKind[] = ['projected', 'past-success', 'past-failure', 'overlap'];
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
  const { t } = useTranslation();
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeKinds, setActiveKinds] = useState<Set<LegendKind>>(() => new Set(ALL_KINDS));

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

  // Calendar fire times come from the backend so cron semantics (timezone,
  // step parsing, DST) match what the engine actually fires. See
  // engine/cron.rs and the cron_fire_times_in_range IPC.
  const { events: allEvents } = useCalendarEvents(entries, range.start, range.end);

  // Detect conflicts over the unfiltered event set so the badges stay
  // honest — toggling "Projected" off shouldn't make a conflict between
  // a projected and a past run disappear. Conflict counts then drive the
  // overlap filter below.
  const conflicts = useMemo(() => detectConflicts(allEvents), [allEvents]);

  const events = useMemo(() => {
    // Kind filter: keep events whose CalendarEvent.kind is in the active set.
    const kindFiltered = allEvents.filter((ev) => activeKinds.has(ev.kind));
    // Overlap filter: when "overlap" is OFF, hide events that are in a
    // conflict group (so the calendar reads as "only non-overlapping fires").
    if (activeKinds.has('overlap')) return kindFiltered;
    return kindFiltered.filter((ev) => !conflicts.byEventId.has(ev.id));
  }, [allEvents, activeKinds, conflicts.byEventId]);

  const totalConflicts = conflicts.byHourCell.size + conflicts.byDayCell.size;
  const allActive = activeKinds.size === ALL_KINDS.length;

  const toggleKind = useCallback((kind: LegendKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setActiveKinds(new Set(ALL_KINDS));
  }, []);

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
            className="p-1.5 rounded-card border border-primary/10 hover:bg-secondary/50 text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate(1)}
            className="p-1.5 rounded-card border border-primary/10 hover:bg-secondary/50 text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="px-2.5 py-1 typo-caption rounded-card border border-primary/10 hover:bg-secondary/50 text-foreground transition-colors"
          >
            Today
          </button>
          <span className="typo-heading text-foreground ml-1">
            {headerLabel}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Legend (now: toggle filters) */}
          <div
            className="flex items-center gap-1 mr-3 text-[10px]"
            title={t.schedules.filter_toggle_tooltip}
          >
            <LegendToggle
              active={activeKinds.has('projected')}
              onClick={() => toggleKind('projected')}
              ariaLabel={t.schedules.projected}
            >
              <span className="w-2 h-2 rounded-full bg-blue-400/70" /> {t.schedules.projected}
            </LegendToggle>
            <LegendToggle
              active={activeKinds.has('past-success')}
              onClick={() => toggleKind('past-success')}
              ariaLabel={t.schedules.success}
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-400/80" /> {t.schedules.success}
            </LegendToggle>
            <LegendToggle
              active={activeKinds.has('past-failure')}
              onClick={() => toggleKind('past-failure')}
              ariaLabel={t.schedules.failed}
            >
              <XCircle className="w-3 h-3 text-red-400/80" /> {t.schedules.failed}
            </LegendToggle>
            {totalConflicts > 0 && (
              <LegendToggle
                active={activeKinds.has('overlap')}
                onClick={() => toggleKind('overlap')}
                ariaLabel={t.schedules.overlap}
              >
                <AlertTriangle className="w-3 h-3 text-amber-400/80" /> {t.schedules.overlap}
              </LegendToggle>
            )}
            {!allActive && (
              <button
                type="button"
                onClick={resetFilters}
                aria-label={t.schedules.filter_reset_aria}
                className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-card border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/40 hover:border-primary/30 transition-colors"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                {t.schedules.filter_reset}
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex rounded-card border border-primary/15 overflow-hidden">
            <button
              onClick={() => setView('week')}
              className={`px-2.5 py-1 typo-caption transition-colors ${
                view === 'week'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-foreground hover:text-foreground/70'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-2.5 py-1 typo-caption transition-colors ${
                view === 'month'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-foreground hover:text-foreground/70'
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
        />
      ) : (
        <MonthView
          anchor={anchor}
          events={events}
          colorMap={colorMap}
          conflictsByDayCell={conflicts.byDayCell}
          conflictsByEventId={conflicts.byEventId}
          onEventClick={handleEventClick}
        />
      )}
    </div>
  );
}

// Small toggle chip used by the calendar legend. Renders as a pill button
// with `aria-pressed`, dimmed when inactive so the user can see at a glance
// which kinds are currently filtered out.
function LegendToggle({
  active,
  onClick,
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card border transition-all ${
        active
          ? 'border-primary/15 bg-primary/5 text-foreground/85 hover:bg-primary/10'
          : 'border-primary/5 bg-transparent text-foreground hover:text-foreground/60 hover:border-primary/15 line-through decoration-foreground/30'
      }`}
    >
      {children}
    </button>
  );
}
