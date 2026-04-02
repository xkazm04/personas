import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { useElementVisible } from '@/hooks/utility/useElementVisible';
import {
  CalendarClock, RefreshCw, Pause, Plus, Calendar, Filter, Zap,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import {
  parseScheduleEntry,
  sortByNextRun,
  groupByTimeWindow,
  detectSkippedExecutions,
  type ScheduleEntry,
  type TimeGroup,
} from '../libs/scheduleHelpers';
import { useScheduleActions } from '../libs/useScheduleActions';
import { getSchedulerStatus, startScheduler, stopScheduler } from '@/api/pipeline/scheduler';
import { seedMockCronAgent } from '@/api/pipeline/triggers';
import type { SchedulerStats } from '@/api/pipeline/scheduler';
import ScheduleRow from './ScheduleRow';
import SkippedRecoveryPanel from './SkippedRecoveryPanel';

const ScheduleCalendar = lazy(() => import('./ScheduleCalendar'));

import type { ScheduleViewMode as ViewMode } from '@/lib/constants/uiModes';
import { createLogger } from "@/lib/log";

const logger = createLogger("schedule-timeline");

export default function ScheduleTimeline() {
  const { cronAgents, loading, fetchCronAgents } = useOverviewStore(useShallow((s) => ({
    cronAgents: s.cronAgents,
    loading: s.cronAgentsLoading,
    fetchCronAgents: s.fetchCronAgents,
  })));

  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [schedulerStats, setSchedulerStats] = useState<SchedulerStats | null>(null);
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(null);

  // Listen for sidebar persona filter
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ personaId: string | null }>).detail;
      setFilterPersonaId(detail.personaId);
    };
    window.addEventListener('schedules:filter', handler);
    return () => window.removeEventListener('schedules:filter', handler);
  }, []);

  const [containerRef, isVisible] = useElementVisible<HTMLDivElement>();

  const {
    state: actionState,
    manualExecute,
    updateFrequency,
    toggleEnabled,
    previewCron,
    batchRecover,
  } = useScheduleActions();

  // Load agents + scheduler status when tab becomes visible
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    fetchCronAgents();
    getSchedulerStatus()
      .then((d) => { if (!cancelled) setSchedulerStats(d); })
      .catch(silentCatch("ScheduleTimeline:getSchedulerStatus"));
    return () => { cancelled = true; };
  }, [fetchCronAgents, isVisible]);

  // Auto-refresh every 30s — only while visible
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const interval = setInterval(() => {
      fetchCronAgents();
      getSchedulerStatus()
        .then((d) => { if (!cancelled) setSchedulerStats(d); })
        .catch(silentCatch("ScheduleTimeline:refreshSchedulerStatus"));
    }, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchCronAgents, isVisible]);

  // Immediate refresh when backend fires overdue triggers — only while visible
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const unlisten = listen<{ recovered: number; timestamp: string }>(
      EventName.OVERDUE_TRIGGERS_FIRED,
      () => {
        if (cancelled) return;
        fetchCronAgents();
        getSchedulerStatus()
          .then((d) => { if (!cancelled) setSchedulerStats(d); })
          .catch(silentCatch("ScheduleTimeline:overdueTriggersRefresh"));
      },
    );
    return () => { cancelled = true; unlisten.then((fn) => fn()); };
  }, [fetchCronAgents, isVisible]);

  // Parse all agents into schedule entries, applying persona filter
  const entries = useMemo(() => {
    const all = cronAgents.map(parseScheduleEntry);
    if (!filterPersonaId) return all;
    return all.filter((e) => e.agent.persona_id === filterPersonaId);
  }, [cronAgents, filterPersonaId]);

  const sorted = useMemo(() => sortByNextRun(entries), [entries]);
  const grouped = useMemo(() => groupByTimeWindow(sorted), [sorted]);
  const skipped = useMemo(() => detectSkippedExecutions(cronAgents), [cronAgents]);

  const activeCount = entries.filter((e) => e.health !== 'paused').length;
  const pausedCount = entries.filter((e) => e.health === 'paused').length;

  const handleSeedSchedule = useCallback(async () => {
    try { await seedMockCronAgent(); await fetchCronAgents(); }
    catch (err) { logger.error('Failed to seed mock schedule', { error: err }); }
  }, [fetchCronAgents]);

  const handleToggleScheduler = async () => {
    try {
      const result = schedulerStats?.running
        ? await stopScheduler()
        : await startScheduler();
      setSchedulerStats(result);
    } catch { /* toast handled by actions */ }
  };

  const renderEntries = (items: ScheduleEntry[]) =>
    items.map((entry) => (
      <ScheduleRow
        key={entry.agent.trigger_id}
        entry={entry}
        existingEntries={entries}
        isExecuting={actionState.executing === entry.agent.trigger_id}
        isEditing={actionState.editing === entry.agent.trigger_id}
        onManualExecute={() => manualExecute(entry.agent)}
        onToggleEnabled={() => toggleEnabled(entry.agent)}
        onUpdateFrequency={(cron, interval) => updateFrequency(entry.agent, cron, interval)}
        onPreviewCron={previewCron}
      />
    ));

  return (
    <div ref={containerRef}>
    <ContentBox>
      <ContentHeader
        icon={<CalendarClock className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title="Schedule Timeline"
        subtitle="Aggregated view of all scheduled agent executions. Cron schedules use UTC."
        actions={
          <div className="flex items-center gap-3">
            {/* Scheduler engine status */}
            {schedulerStats && (
              <button
                onClick={handleToggleScheduler}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  schedulerStats.running
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                }`}
                title={schedulerStats.running ? 'Scheduler running -- click to pause' : 'Scheduler stopped -- click to start'}
              >
                {schedulerStats.running ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Engine On
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3" />
                    Engine Off
                  </>
                )}
              </button>
            )}

            {/* Mock seed (dev only) */}
            {import.meta.env.DEV && (
              <button onClick={handleSeedSchedule} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock schedule (dev only)">
                <Plus className="w-3.5 h-3.5" /> Mock Schedule
              </button>
            )}

            {/* Stats badges */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Zap className="w-3 h-3" />
                {activeCount} active
              </span>
              {pausedCount > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/5 text-muted-foreground/50 border border-primary/10">
                  <Pause className="w-3 h-3" />
                  {pausedCount} paused
                </span>
              )}
            </div>

            {/* View toggle */}
            <ScheduleViewTabs value={viewMode} onChange={setViewMode} />

            {/* Refresh */}
            <button
              onClick={() => fetchCronAgents()}
              disabled={loading}
              className="p-2 rounded-lg border border-primary/10 hover:bg-secondary/50 hover:border-primary/20 text-muted-foreground/70 transition-all disabled:opacity-40"
              title="Refresh schedules"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      >
      </ContentHeader>

      <ContentBody centered>
        {/* Active filter indicator */}
        {filterPersonaId && (() => {
          const agent = cronAgents.find((a) => a.persona_id === filterPersonaId);
          return agent ? (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-blue-500/[0.06] border border-blue-500/15 text-xs text-blue-400/90">
              <Filter className="w-3.5 h-3.5 shrink-0" />
              <span>
                Showing schedules for <span className="font-semibold">{agent.persona_name}</span>
              </span>
              <button
                onClick={() => {
                  setFilterPersonaId(null);
                  window.dispatchEvent(new CustomEvent('schedules:filter', { detail: { personaId: null } }));
                }}
                className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium hover:bg-blue-500/15 transition-colors"
              >
                Clear
              </button>
            </div>
          ) : null;
        })()}

        {loading && cronAgents.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground/70">
            <LoadingSpinner size="lg" className="mr-2" />
            Loading schedules...
          </div>
        ) : cronAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-foreground/60">
            <div className="w-20 h-20 rounded-2xl bg-blue-500/[0.07] border border-blue-500/15 flex items-center justify-center">
              <CalendarClock className="w-10 h-10 text-blue-400/50" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="typo-heading text-foreground/70">No scheduled agents</p>
              <p className="text-xs text-muted-foreground/50 max-w-[280px] mx-auto leading-relaxed">
                Create a cron or polling trigger on any agent to see its schedule here. Missed runs are recovered automatically on startup.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Skipped execution recovery */}
            {viewMode !== 'calendar' && (
              <SkippedRecoveryPanel
                skipped={skipped}
                recoveringId={actionState.recovering}
                onBatchRecover={batchRecover}
                onManualExecute={(agent) => manualExecute(agent)}
              />
            )}

            {/* Main schedule view */}
            {viewMode === 'calendar' ? (
              <Suspense fallback={<div className="flex items-center justify-center py-12 text-muted-foreground/60"><LoadingSpinner className="mr-2" />Loading calendar...</div>}>
                <ScheduleCalendar entries={entries} />
              </Suspense>
            ) : viewMode === 'grouped' ? (
              <GroupedView groups={grouped} renderEntries={renderEntries} />
            ) : (
              <div className="space-y-1.5">
                {renderEntries(sorted)}
              </div>
            )}
          </div>
        )}

      </ContentBody>
    </ContentBox>
    </div>
  );
}

// -- Segmented View Toggle (tablist) -------------------------------------------

const VIEW_OPTIONS: { value: ViewMode; label: string; icon?: true }[] = [
  { value: 'grouped', label: 'Grouped' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'calendar', label: 'Calendar', icon: true },
];

function ScheduleViewTabs({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const idx = VIEW_OPTIONS.findIndex((o) => o.value === value);
    let next: number;
    if (e.key === 'ArrowRight') next = (idx + 1) % VIEW_OPTIONS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + VIEW_OPTIONS.length) % VIEW_OPTIONS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = VIEW_OPTIONS.length - 1;
    else return;

    e.preventDefault();
    onChange(VIEW_OPTIONS[next]!.value);
    const tabs = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label="Schedule view"
      className="flex rounded-lg border border-primary/15 overflow-hidden bg-secondary/20"
      onKeyDown={handleKeyDown}
    >
      {VIEW_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-all ${
              selected
                ? 'bg-primary/15 text-foreground/90 shadow-sm'
                : 'text-muted-foreground/50 hover:text-foreground/70 hover:bg-primary/5'
            }`}
          >
            {opt.icon && <Calendar className="w-3.5 h-3.5" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// -- Grouped View --------------------------------------------------------------

function GroupedView({
  groups,
  renderEntries,
}: {
  groups: TimeGroup[];
  renderEntries: (entries: ScheduleEntry[]) => React.ReactNode;
}) {
  const GROUP_COLORS: Record<string, string> = {
    'Overdue': 'text-red-400 border-red-500/20',
    'Next 15 minutes': 'text-emerald-400 border-emerald-500/20',
    'Next hour': 'text-blue-400 border-blue-500/20',
    'Next 6 hours': 'text-violet-400 border-violet-500/20',
    'Next 24 hours': 'text-amber-400 border-amber-500/20',
    'Later': 'text-foreground/60 border-primary/10',
    'Paused / Unscheduled': 'text-foreground/40 border-primary/10',
  };

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <div className={`flex items-center gap-2 mb-2 pb-1.5 border-b ${GROUP_COLORS[group.label] || 'text-foreground/60 border-primary/10'}`}>
            <span className="typo-caption uppercase tracking-wider">
              {group.label}
            </span>
            <span className="text-[10px] font-mono opacity-60">
              ({group.entries.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {renderEntries(group.entries)}
          </div>
        </div>
      ))}
    </div>
  );
}
