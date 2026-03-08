import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Activity } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader } from '@/features/shared/components/ContentLayout';
import { useRealtimeEvents } from '@/hooks/realtime/useRealtimeEvents';
import { useTimelineReplay } from '@/hooks/realtime/useTimelineReplay';
import RealtimeStatsBar from './RealtimeStatsBar';
import EventBusVisualization from './EventBusVisualization';
import EventDetailDrawer from './EventDetailDrawer';
import TimelinePlayer from './TimelinePlayer';
import EventBusFilterBar from './EventBusFilterBar';
import { useEventBusFilter } from '../libs/useEventBusFilter';

export default function RealtimeVisualizerPage() {
  const personas = usePersonaStore((s) => s.personas);

  const {
    events: liveEvents,
    stats,
    isPaused,
    isConnected,
    selectedEvent,
    droppedCount,
    togglePause,
    selectEvent,
    triggerTestFlow,
    testFlowLoading,
  } = useRealtimeEvents();

  const timeline = useTimelineReplay();
  const rawDisplayEvents = timeline.active ? timeline.replayEvents : liveEvents;

  const {
    filter, setFilter, filteredEvents, filteredCount, totalCount,
    savedViews, activeViewId, applyView, saveCurrentView, deleteView,
  } = useEventBusFilter(rawDisplayEvents);

  const displayEvents = filteredEvents;

  const discoveredSources = useMemo(() => {
    const sources = new Set<string>();
    for (const evt of rawDisplayEvents) {
      const src = evt.source_id || evt.source_type;
      if (src) sources.add(src);
    }
    return [...sources].sort();
  }, [rawDisplayEvents]);

  const personaInfos = useMemo(
    () => personas.map((p) => ({ id: p.id, name: p.name, icon: p.icon ?? null, color: p.color ?? null })),
    [personas],
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={<Activity className="w-5 h-5" />}
        iconColor="cyan"
        title="Event Bus Monitor"
        subtitle={
          timeline.active
            ? `Replaying ${timeline.range === '1d' ? 'last 24 hours' : 'last 7 days'} at ${timeline.speed}x speed`
            : 'Live visualization of event flows and persona interactions'
        }
      />

      {!timeline.active && (
        <RealtimeStatsBar stats={stats} isPaused={isPaused} isConnected={isConnected} testFlowLoading={testFlowLoading} onPause={togglePause} onTestFlow={triggerTestFlow} />
      )}

      <EventBusFilterBar
        filter={filter} onFilterChange={setFilter} savedViews={savedViews} activeViewId={activeViewId}
        onApplyView={applyView} onSaveView={saveCurrentView} onDeleteView={deleteView}
        personas={personaInfos} discoveredSources={discoveredSources} filteredCount={filteredCount} totalCount={totalCount}
      />

      <div className="flex-1 relative overflow-hidden">
        <EventBusVisualization events={displayEvents} personas={personaInfos} droppedCount={timeline.active ? 0 : droppedCount} onSelectEvent={selectEvent} />
        <AnimatePresence>
          {selectedEvent && <EventDetailDrawer event={selectedEvent} onClose={() => selectEvent(null)} />}
        </AnimatePresence>
      </div>

      <TimelinePlayer {...timeline} onEnterReplay={timeline.enterReplay} onExitReplay={timeline.exitReplay} onTogglePlay={timeline.togglePlay} onSetSpeed={timeline.setSpeed} onSeek={timeline.seekTo} />
    </ContentBox>
  );
}
