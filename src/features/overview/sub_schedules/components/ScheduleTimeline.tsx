import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  CalendarClock, Loader2, RefreshCw, Pause, Plus,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { usePersonaStore } from '@/stores/personaStore';
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

type ViewMode = 'timeline' | 'grouped';

export default function ScheduleTimeline() {
  const cronAgents = usePersonaStore((s) => s.cronAgents);
  const loading = usePersonaStore((s) => s.cronAgentsLoading);
  const fetchCronAgents = usePersonaStore((s) => s.fetchCronAgents);

  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [schedulerStats, setSchedulerStats] = useState<SchedulerStats | null>(null);

  const {
    state: actionState,
    manualExecute,
    updateFrequency,
    toggleEnabled,
    previewCron,
    batchRecover,
  } = useScheduleActions();

  // Load agents + scheduler status on mount
  useEffect(() => {
    let cancelled = false;
    fetchCronAgents();
    getSchedulerStatus()
      .then((d) => { if (!cancelled) setSchedulerStats(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fetchCronAgents]);

  // Auto-refresh every 30s
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      fetchCronAgents();
      getSchedulerStatus()
        .then((d) => { if (!cancelled) setSchedulerStats(d); })
        .catch(() => {});
    }, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchCronAgents]);

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
    catch (err) { console.error('Failed to seed mock schedule:', err); }
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
        isExecuting={actionState.executing === entry.agent.trigger_id}
        isEditing={actionState.editing === entry.agent.trigger_id}
        onManualExecute={() => manualExecute(entry.agent)}
        onToggleEnabled={() => toggleEnabled(entry.agent)}
        onUpdateFrequency={(cron, interval) => updateFrequency(entry.agent, cron, interval)}
        onPreviewCron={previewCron}
      />
    ));

  return (
    <ContentBox>
      <ContentHeader
        icon={<CalendarClock className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title="Schedule Timeline"
        subtitle="Aggregated view of all scheduled agent executions"
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
              <button onClick={handleSeedSchedule} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock schedule (dev only)">
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
            <div className="flex rounded-lg border border-primary/15 overflow-hidden">
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'grouped'
                    ? 'bg-primary/10 text-foreground/90'
                    : 'text-muted-foreground/60 hover:text-foreground/70'
                }`}
              >
                Grouped
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'timeline'
                    ? 'bg-primary/10 text-foreground/90'
                    : 'text-muted-foreground/60 hover:text-foreground/70'
                }`}
              >
                Timeline
              </button>
            </div>

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
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground/60">
            <span>Triggers fired: <span className="font-mono text-foreground/70">{schedulerStats.triggers_fired}</span></span>
            <span>Events processed: <span className="font-mono text-foreground/70">{schedulerStats.events_processed}</span></span>
            <span>Delivered: <span className="font-mono text-foreground/70">{schedulerStats.events_delivered}</span></span>
            {schedulerStats.events_failed > 0 && (
              <span className="text-red-400">
                Failed: <span className="font-mono">{schedulerStats.events_failed}</span>
              </span>
            )}
          </div>
        )}
      </ContentHeader>

      <ContentBody centered>
        {loading && cronAgents.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground/70">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading schedules...
          </div>
        ) : cronAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground/70">
            <CalendarClock className="w-8 h-8 opacity-40" />
            <p className="text-sm">No scheduled agents found.</p>
            <p className="text-xs">Create a schedule or polling trigger on any agent to see it here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Skipped execution recovery */}
            <SkippedRecoveryPanel
              skipped={skipped}
              recoveringId={actionState.recovering}
              onBatchRecover={batchRecover}
              onManualExecute={(agent) => manualExecute(agent)}
            />

            {/* Main schedule view */}
            {viewMode === 'grouped' ? (
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
    'Later': 'text-muted-foreground/60 border-primary/10',
    'Paused / Unscheduled': 'text-muted-foreground/40 border-primary/10',
  };

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <div className={`flex items-center gap-2 mb-2 pb-1.5 border-b ${GROUP_COLORS[group.label] || 'text-muted-foreground/60 border-primary/10'}`}>
            <span className="text-xs font-semibold uppercase tracking-wider">
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
