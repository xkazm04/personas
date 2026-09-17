// SchedulesOverlay — the title-bar Schedules surface: header + calendar.
//
// Was `ScheduleTimeline`, which carried three tabs (grouped list, calendar,
// orchestration). The grouped list was retired in favour of the calendar and
// the orchestration ledger moved to the Monitor's Activity board
// (`fleet/monitor/grid/orchestration`), so this is one view with no tab bar:
// the scheduler engine switch and the active/paused counts in the header, the
// sidebar group filter, and the week/month calendar beneath.

import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useMemo, useState, useRef, lazy, Suspense } from 'react';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { useElementVisible } from '@/hooks/utility/useElementVisible';
import { CalendarClock, RefreshCw, Pause, Filter, Zap } from 'lucide-react';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { parseScheduleEntry, type ScheduleEntry } from '../libs/scheduleHelpers';
import { getSchedulerStatus, startScheduler, stopScheduler } from '@/api/pipeline/scheduler';
import type { SchedulerStats } from '@/api/pipeline/scheduler';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { useTranslation } from '@/i18n/useTranslation';

const ScheduleCalendar = lazy(() => import('./ScheduleCalendar'));

/** Shallow field-equality for the flat generated CronAgent record. Used to
 *  reuse previous ScheduleEntry objects across poll refreshes so the calendar's
 *  memoized event derivation can skip work when an agent's data is unchanged. */
function cronAgentEquals(a: CronAgent, b: CronAgent): boolean {
  if (a === b) return true;
  const keys = Object.keys(b) as (keyof CronAgent)[];
  if (Object.keys(a).length !== keys.length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/** A calm ghost under the permanent header while the first read is in flight —
 *  never a spinner (the shared `LoadingSpinner` renders null). */
function CalendarGhost() {
  return (
    <div aria-hidden className="space-y-2 animate-fade-in" style={{ animationDelay: '150ms' }}>
      <div className="h-8 rounded-card border border-border/60 bg-primary/[0.04]" />
      <div className="h-64 rounded-card border border-border/60 bg-primary/[0.04]" />
    </div>
  );
}

export default function SchedulesOverlay() {
  const { t, tx } = useTranslation();
  const { cronAgents, loading, fetchCronAgents } = useOverviewStore(useShallow((s) => ({
    cronAgents: s.cronAgents,
    loading: s.cronAgentsLoading,
    fetchCronAgents: s.fetchCronAgents,
  })));

  const [schedulerStats, setSchedulerStats] = useState<SchedulerStats | null>(null);
  // Sidebar filter is group-scoped (a team or the "No team" bucket), so it
  // carries a SET of persona ids plus a display label. `null` = show all.
  const [filter, setFilter] = useState<{ ids: Set<string>; label: string } | null>(null);

  // Listen for sidebar group filter
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ personaIds: string[] | null; label?: string | null }>).detail;
      setFilter(detail.personaIds ? { ids: new Set(detail.personaIds), label: detail.label ?? '' } : null);
    };
    window.addEventListener('schedules:filter', handler);
    return () => window.removeEventListener('schedules:filter', handler);
  }, []);

  const [containerRef, isVisible] = useElementVisible<HTMLDivElement>();

  // Unified refresh: initial load, 30s poll, and OVERDUE_TRIGGERS_FIRED all
  // funnel through a single scheduler with in-flight dedupe + 500ms coalescing
  // so a poll tick coinciding with an overdue event does not double-fetch.
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: Promise<void> | null = null;
    let pending = false;

    const doRefresh = (): Promise<void> => {
      if (inFlight) { pending = true; return inFlight; }
      const p = (async () => {
        try {
          await Promise.all([
            fetchCronAgents(),
            getSchedulerStatus()
              .then((d) => { if (!cancelled) setSchedulerStats(d); })
              .catch(silentCatch("SchedulesOverlay:refresh")),
          ]);
        } finally {
          inFlight = null;
          if (pending && !cancelled) {
            pending = false;
            doRefresh();
          }
        }
      })();
      inFlight = p;
      return p;
    };

    const scheduleRefresh = () => {
      if (coalesceTimer || cancelled) return;
      coalesceTimer = setTimeout(() => {
        coalesceTimer = null;
        if (!cancelled) doRefresh();
      }, 500);
    };

    // Initial load fires immediately (skip the coalesce window)
    doRefresh();

    const interval = setInterval(scheduleRefresh, 30_000);

    const unlistenP = typedListen(
      EventName.OVERDUE_TRIGGERS_FIRED,
      () => { if (!cancelled) scheduleRefresh(); },
    );

    return () => {
      cancelled = true;
      if (coalesceTimer) clearTimeout(coalesceTimer);
      clearInterval(interval);
      unlistenP.then((fn) => fn()).catch(silentCatch("SchedulesOverlay:unlisten"));
    };
  }, [fetchCronAgents, isVisible]);

  // Parse all agents into schedule entries, applying the group filter.
  // Entries are cached per trigger_id and reused when the underlying agent
  // row is unchanged — every 30s poll produces a brand-new cronAgents array,
  // and without referentially stable entries the calendar would re-derive
  // its events on every tick even though nothing changed.
  const entryCacheRef = useRef(new Map<string, ScheduleEntry>());
  const entries = useMemo(() => {
    const cache = entryCacheRef.current;
    const nextCache = new Map<string, ScheduleEntry>();
    const all = cronAgents.map((agent) => {
      const prev = cache.get(agent.trigger_id);
      const entry = prev && cronAgentEquals(prev.agent, agent) ? prev : parseScheduleEntry(agent);
      nextCache.set(agent.trigger_id, entry);
      return entry;
    });
    entryCacheRef.current = nextCache;
    if (!filter) return all;
    return all.filter((e) => filter.ids.has(e.agent.persona_id));
  }, [cronAgents, filter]);

  const activeCount = entries.filter((e) => e.health !== 'paused').length;
  const pausedCount = entries.filter((e) => e.health === 'paused').length;

  const handleToggleScheduler = async () => {
    try {
      const result = schedulerStats?.running
        ? await stopScheduler()
        : await startScheduler();
      setSchedulerStats(result);
    } catch (err) { silentCatch("features/schedules/components/SchedulesOverlay:toggleScheduler")(err); }
  };

  return (
    <div ref={containerRef} className="flex-1 min-h-0 flex flex-col w-full">
    <ContentBox data-testid="schedules-page">
      <ContentHeader
        icon={<CalendarClock className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title={t.schedules.title}
        actions={
          <div className="flex items-center gap-3">
            {/* Scheduler engine status */}
            {schedulerStats && (
              <button
                type="button"
                onClick={handleToggleScheduler}
                className={`flex items-center gap-1.5 px-2.5 py-1 typo-caption rounded-card border transition-colors ${
                  schedulerStats.running
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                }`}
                title={schedulerStats.running ? t.schedules.engine_running_title : t.schedules.engine_stopped_title}
              >
                {schedulerStats.running ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {t.schedules.engine_on}
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3" />
                    {t.schedules.engine_off}
                  </>
                )}
              </button>
            )}

            {/* Stats badges */}
            <div className="flex items-center gap-1.5 typo-caption">
              <StatusBadge
                variant="info"
                icon={<Zap className="w-3 h-3" />}
                className="px-2 py-1 rounded-card typo-caption"
              >
                {tx(t.schedules.active_count, { count: activeCount })}
              </StatusBadge>
              {pausedCount > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-card bg-primary/5 text-foreground border border-primary/10">
                  <Pause className="w-3 h-3" />
                  {tx(t.schedules.paused_count, { count: pausedCount })}
                </span>
              )}
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => fetchCronAgents()}
              disabled={loading}
              className="p-2 rounded-card border border-primary/10 hover:bg-secondary/50 hover:border-primary/20 text-foreground transition-all disabled:opacity-40"
              title={t.schedules.refresh_schedules}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      >
      </ContentHeader>

      <ContentBody centered>
        {/* Active filter indicator */}
        {filter && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-card bg-blue-500/[0.06] border border-blue-500/15 typo-caption text-blue-400/90">
            <Filter className="w-3.5 h-3.5 shrink-0" />
            <span>
              {t.schedules.showing_for} <span className="font-semibold">{filter.label}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setFilter(null);
                window.dispatchEvent(new CustomEvent('schedules:filter', { detail: { personaIds: null } }));
              }}
              className="ml-auto px-1.5 py-0.5 rounded-interactive typo-label font-medium hover:bg-blue-500/15 transition-colors"
            >
              {t.common.clear}
            </button>
          </div>
        )}

        {loading && cronAgents.length === 0 ? (
          // A fetch never hides rendered rows: the ghost shows only while
          // nothing has landed yet (loading law 1).
          <CalendarGhost />
        ) : cronAgents.length === 0 ? (
          <ScenarioEmptyState
            icon={CalendarClock}
            title={t.schedules.no_scheduled_agents}
            description={t.schedules.no_scheduled_hint}
          />
        ) : (
          <Suspense fallback={<CalendarGhost />}>
            <ScheduleCalendar entries={entries} />
          </Suspense>
        )}
      </ContentBody>
    </ContentBox>
    </div>
  );
}
