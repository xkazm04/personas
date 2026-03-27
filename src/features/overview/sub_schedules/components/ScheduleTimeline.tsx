import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { useElementVisible } from '@/hooks/utility/useElementVisible';
import {
  CalendarClock, RefreshCw, Pause, Plus, Calendar,
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

  // Parse all agents into schedule entries
  const entries = useMemo(
    () => cronAgents.map(parseScheduleEntry),
    [cronAgents],
  );

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
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <span className="px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {activeCount} active
              </span>
              {pausedCount > 0 && (
                <span className="px-2 py-0.5 rounded-lg bg-primary/5 text-muted-foreground/50 border border-primary/10">
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
              className="p-1.5 rounded-lg border border-primary/10 hover:bg-secondary/50 text-muted-foreground/70 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      >
        {/* Scheduler stats bar */}
        {schedulerStats && (
          <div className="flex flex-col gap-2 mt-3">
            <div className="flex items-center gap-4 text-xs text-foreground/60">
              <span>Triggers fired: <span className="font-mono text-foreground/80">{schedulerStats.triggersFired}</span></span>
              <span>Events processed: <span className="font-mono text-foreground/80">{schedulerStats.eventsProcessed}</span></span>
              <span>Delivered: <span className="font-mono text-foreground/80">{schedulerStats.eventsDelivered}</span></span>
              {schedulerStats.eventsFailed > 0 && (
                <span className="text-red-400">
                  Failed: <span className="font-mono">{schedulerStats.eventsFailed}</span>
                </span>
              )}
              {schedulerStats.chainCascadesTotal > 0 && (
                <span title={`Total wall time: ${schedulerStats.chainCascadeDurationMs}ms`}>
                  Chain cascades: <span className="font-mono text-foreground/80">{schedulerStats.chainCascadesTotal}</span>
                  <span className="ml-1 text-foreground/50">({schedulerStats.chainCascadeDurationMs}ms)</span>
                </span>
              )}
              {schedulerStats.queueRejections > 0 && (
                <span className="text-amber-400" title="Executions rejected due to queue backpressure (queue full)">
                  Queue rejected: <span className="font-mono">{schedulerStats.queueRejections}</span>
                </span>
              )}
              {schedulerStats.subscriptionsCrashed > 0 && (
                <span className="text-red-400" title="Subscription ticks that panicked — the loop recovered but a crash occurred">
                  Subs crashed: <span className="font-mono">{schedulerStats.subscriptionsCrashed}</span>
                </span>
              )}
              {schedulerStats.traceContinuityBreaks > 0 && (
                <span className="text-orange-400" title="Chain trace IDs lost due to payload parse failures — downstream executions created orphaned trace roots">
                  Trace breaks: <span className="font-mono">{schedulerStats.traceContinuityBreaks}</span>
                </span>
              )}
            </div>
            {/* Per-subscription health indicators */}
            {schedulerStats.subscriptionHealth.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                {schedulerStats.subscriptionHealth.map((sub) => (
                  <span
                    key={sub.name}
                    className={`px-1.5 py-0.5 rounded font-mono border ${
                      sub.consecutivePanics > 0
                        ? 'bg-red-500/10 border-red-500/20 text-red-400'
                        : sub.overrun
                          ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                          : 'bg-primary/5 border-primary/10 text-foreground/60'
                    }`}
                    title={`${sub.name}: last ${sub.lastTickDurationMs}ms / avg ${sub.avgTickDurationMs}ms / max ${sub.maxTickDurationMs}ms (interval ${sub.intervalMs}ms) | ticks: ${sub.tickCount}, errors: ${sub.errorCount}${sub.consecutivePanics > 0 ? `, consecutive panics: ${sub.consecutivePanics}` : ''}${sub.overrun ? ' — OVERRUN' : ''}`}
                  >
                    {sub.name} {sub.lastTickDurationMs}ms
                    {sub.consecutivePanics > 0 && ' PANIC'}
                    {sub.consecutivePanics === 0 && sub.overrun && ' !!'}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </ContentHeader>

      <ContentBody centered>
        {loading && cronAgents.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground/70">
            <LoadingSpinner size="lg" className="mr-2" />
            Loading schedules...
          </div>
        ) : cronAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-foreground/60">
            <CalendarClock className="w-8 h-8 opacity-40" />
            <p className="text-sm">No scheduled agents found.</p>
            <p className="text-xs text-foreground/50">Create a schedule or polling trigger on any agent to see it here.</p>
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

        {/* CLI Fallback Scheduling */}
        <CliFallbackSection entries={entries} />
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
      className="flex rounded-lg border border-primary/15 overflow-hidden"
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
            className={`px-2.5 py-1 text-xs flex items-center gap-1 transition-colors ${
              selected
                ? 'bg-primary/10 text-foreground/90'
                : 'text-muted-foreground/60 hover:text-foreground/70'
            }`}
          >
            {opt.icon && <Calendar className="w-3 h-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function CliFallbackSection({ entries }: { entries: import('../libs/scheduleHelpers').ScheduleEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const loadCommands = async () => {
    setLoading(true);
    const results: Record<string, string> = {};
    for (const entry of entries.slice(0, 10)) {
      try {
        const resp = await fetch(`http://127.0.0.1:9420/api/settings/cli-fallback/${entry.agent.persona_id}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.data?.command) {
            results[entry.agent.persona_id] = data.data.cron_instruction;
          }
        }
      } catch { break; } // Management API not running
    }
    setCommands(results);
    setLoading(false);
  };

  if (entries.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
      <button
        data-testid="cli-fallback-section"
        onClick={() => { setExpanded(!expanded); if (!expanded && Object.keys(commands).length === 0) loadCommands(); }}
        className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M4 7l2 2-2 2M8 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Claude CLI Fallback Scheduling
        <span className="text-[10px] text-muted-foreground/40 ml-1">
          {expanded ? '(click to collapse)' : '— run agents when the app is closed'}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-primary/5">
          <p className="text-[11px] text-muted-foreground/50 py-2">
            Use these commands with your OS scheduler (cron / Task Scheduler) to execute agents via Claude CLI + Personas MCP server when the desktop app is not running.
          </p>
          {loading ? (
            <p className="text-xs text-muted-foreground/40 py-2">Loading commands...</p>
          ) : Object.keys(commands).length === 0 ? (
            <p className="text-xs text-muted-foreground/40 py-2">Management API not available. Start the Personas app first.</p>
          ) : (
            Object.entries(commands).map(([pid, cmd]) => {
              const entry = entries.find(e => e.agent.persona_id === pid);
              return (
                <div key={pid} className="rounded-lg bg-black/20 p-2.5">
                  <p className="text-[11px] font-medium text-foreground/70 mb-1">{entry?.agent.persona_name || pid}</p>
                  <pre className="text-[10px] text-muted-foreground/60 font-mono whitespace-pre-wrap break-all select-all">{cmd}</pre>
                </div>
              );
            })
          )}
        </div>
      )}
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
