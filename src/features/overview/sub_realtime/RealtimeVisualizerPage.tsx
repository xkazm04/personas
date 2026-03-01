import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Activity } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader } from '@/features/shared/components/ContentLayout';
import { useRealtimeEvents } from '@/hooks/realtime/useRealtimeEvents';
import { useTimelineReplay } from '@/hooks/realtime/useTimelineReplay';
import RealtimeStatsBar from '@/features/overview/sub_realtime/RealtimeStatsBar';
import EventBusVisualization from '@/features/overview/sub_realtime/EventBusVisualization';
import EventDetailDrawer from '@/features/overview/sub_realtime/EventDetailDrawer';
import TimelinePlayer from '@/features/overview/sub_realtime/TimelinePlayer';

export default function RealtimeVisualizerPage() {
  const personas = usePersonaStore((s) => s.personas);

  // ── Live event stream ────────────────────────────────────────────
  const {
    events: liveEvents,
    stats,
    isPaused,
    isConnected,
    selectedEvent,
    togglePause,
    selectEvent,
    triggerTestFlow,
    testFlowLoading,
  } = useRealtimeEvents();

  // ── Timeline replay ──────────────────────────────────────────────
  const timeline = useTimelineReplay();

  // When replay is active, feed replay events to the visualization
  const displayEvents = timeline.active ? timeline.replayEvents : liveEvents;

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
        title="Event Bus Monitor"
        subtitle={
          timeline.active
            ? `Replaying ${timeline.range === '1d' ? 'last 24 hours' : 'last 7 days'} at ${timeline.speed}x speed`
            : 'Live visualization of event flows and persona interactions'
        }
      />

      {/* Stats bar — hidden during replay to avoid confusion with live stats */}
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

      {/* Main visualization area */}
      <div className="flex-1 relative overflow-hidden">
        <EventBusVisualization
          events={displayEvents}
          personas={personaInfos}
          onSelectEvent={selectEvent}
        />

        {/* Event detail drawer */}
        <AnimatePresence>
          {selectedEvent && (
            <EventDetailDrawer
              event={selectedEvent}
              onClose={() => selectEvent(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Bottom Timeline Player ── */}
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
