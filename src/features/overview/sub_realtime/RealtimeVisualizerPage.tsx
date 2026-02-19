import { AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import RealtimeStatsBar from '@/features/overview/sub_realtime/RealtimeStatsBar';
import EventBusVisualization from '@/features/overview/sub_realtime/EventBusVisualization';
import EventDetailDrawer from '@/features/overview/sub_realtime/EventDetailDrawer';

export default function RealtimeVisualizerPage() {
  const personas = usePersonaStore((s) => s.personas);
  const {
    events,
    stats,
    isPaused,
    isConnected,
    selectedEvent,
    togglePause,
    selectEvent,
    triggerTestFlow,
    testFlowLoading,
  } = useRealtimeEvents();

  // Map personas to the shape expected by EventBusVisualization
  const personaInfos = personas.map(p => ({
    id: p.id,
    name: p.name,
    icon: p.icon ?? null,
    color: p.color ?? null,
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats bar */}
      <RealtimeStatsBar
        stats={stats}
        isPaused={isPaused}
        isConnected={isConnected}
        testFlowLoading={testFlowLoading}
        onPause={togglePause}
        onTestFlow={triggerTestFlow}
      />

      {/* Main visualization area */}
      <div className="flex-1 relative overflow-hidden">
        <EventBusVisualization
          events={events}
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
    </div>
  );
}
