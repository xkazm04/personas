import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Activity } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useRealtimeEvents } from '@/hooks/realtime/useRealtimeEvents';
import { useTimelineReplay } from '@/hooks/realtime/useTimelineReplay';
import RealtimeStatsBar from '@/features/overview/sub_realtime/RealtimeStatsBar';
import EventBusVisualization from '@/features/overview/sub_realtime/event_bus/EventBusVisualization';
import EventDetailDrawer from '@/features/overview/sub_realtime/EventDetailDrawer';
import TimelinePlayer from '@/features/overview/sub_realtime/TimelinePlayer';
import EventBusFilterBar from '@/features/overview/sub_realtime/event_bus/state/EventBusFilterBar';
import { useEventBusFilter } from '@/features/overview/sub_realtime/useEventBusFilter';

export default function RealtimeVisualizerPage() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);

  // -- Live event stream --------------------------------------------
  const {
    events: liveEvents,
    stats,
    isPaused,
    isConnected,
    selectedEvent,
    droppedCount,
    animationMapRef: liveAnimMapRef,
    animTick: liveAnimTick,
    togglePause,
    selectEvent,
    triggerTestFlow,
    testFlowLoading,
  } = useRealtimeEvents();

  // -- Timeline replay ----------------------------------------------
  const timeline = useTimelineReplay();

  // When replay is active, feed replay events to the visualization
  const rawDisplayEvents = timeline.active ? timeline.replayEvents : liveEvents;
  const animationMapRef = timeline.active ? timeline.animationMapRef : liveAnimMapRef;
  const animTick = timeline.active ? timeline.animTick : liveAnimTick;

  // -- Event bus filter ----------------------------------------------
  const {
    filter,
    setFilter,
    filteredEvents,
    filteredCount,
    totalCount,
    savedViews,
    activeViewId,
    applyView,
    saveCurrentView,
    deleteView,
  } = useEventBusFilter(rawDisplayEvents);

  const displayEvents = filteredEvents;

  // Collect discovered sources from events for the filter dropdown
  const discoveredSources = useMemo(() => {
    const sources = new Set<string>();
    for (const evt of rawDisplayEvents) {
      const src = evt.source_id || evt.source_type;
      if (src) sources.add(src);
    }
    return [...sources].sort();
  }, [rawDisplayEvents]);

  // Map personas to the shape expected by EventBusVisualization
  const personaInfos = useMemo(
    () =>
      personas.map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon ?? null,
        color: p.color ?? null,
      })),
    [personas],
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={<Activity className="w-5 h-5" />}
        iconColor="cyan"
        title={t.overview.realtime_page.title}
        subtitle={
          timeline.active
            ? (timeline.range === '1d' ? tx(t.overview.realtime_page.replay_subtitle_1d, { speed: timeline.speed }) : tx(t.overview.realtime_page.replay_subtitle_7d, { speed: timeline.speed }))
            : t.overview.realtime_page.live_subtitle
        }
      />

      {/* Stats bar -- hidden during replay to avoid confusion with live stats */}
      {!timeline.active && (
        <RealtimeStatsBar
          stats={stats}
          isPaused={isPaused}
          isConnected={isConnected}
          testFlowLoading={testFlowLoading}
          onPause={togglePause}
          onTestFlow={triggerTestFlow}
        />
      )}

      {/* Filter bar */}
      <EventBusFilterBar
        filter={filter}
        onFilterChange={setFilter}
        savedViews={savedViews}
        activeViewId={activeViewId}
        onApplyView={applyView}
        onSaveView={saveCurrentView}
        onDeleteView={deleteView}
        personas={personaInfos}
        discoveredSources={discoveredSources}
        filteredCount={filteredCount}
        totalCount={totalCount}
      />

      {/* Main visualization area */}
      <div className="flex-1 relative overflow-hidden">
        <EventBusVisualization
          events={displayEvents}
          personas={personaInfos}
          droppedCount={timeline.active ? 0 : droppedCount}
          animationMapRef={animationMapRef}
          animTick={animTick}
          onSelectEvent={selectEvent}
        />

        {/* Event detail drawer */}
        {selectedEvent && (
            <EventDetailDrawer
              event={selectedEvent}
              onClose={() => selectEvent(null)}
            />
          )}
      </div>

      {/* -- Bottom Timeline Player -- */}
      <TimelinePlayer
        {...timeline}
        onEnterReplay={timeline.enterReplay}
        onExitReplay={timeline.exitReplay}
        onTogglePlay={timeline.togglePlay}
        onSetSpeed={timeline.setSpeed}
        onSeek={timeline.seekTo}
      />
    </ContentBox>
  );
}
