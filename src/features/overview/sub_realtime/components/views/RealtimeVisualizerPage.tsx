import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Activity, Orbit, ArrowRightLeft } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useRealtimeEvents } from '@/hooks/realtime/useRealtimeEvents';
import { useTimelineReplay } from '@/hooks/realtime/useTimelineReplay';
import RealtimeStatsBar from '../panels/RealtimeStatsBar';
import EventBusVisualization from './EventBusVisualization';
import SwimLaneVisualization from './SwimLaneVisualization';
import EventDetailDrawer from '../panels/EventDetailDrawer';
import TimelinePlayer from '../panels/TimelinePlayer';
import EventBusFilterBar from '../panels/EventBusFilterBar';
import { useEventBusFilter } from '../../libs/useEventBusFilter';

type VisualizationVariant = 'galaxy' | 'lanes';

const VARIANT_META: Record<VisualizationVariant, { icon: typeof Activity; label: string; description: string }> = {
  galaxy:  { icon: Orbit,          label: 'Galaxy',   description: 'Orbital constellation with comet trails' },
  lanes:   { icon: ArrowRightLeft, label: 'Lanes',    description: 'Horizontal swim-lane flow diagram' },
};

export default function RealtimeVisualizerPage() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [variant, setVariant] = useState<VisualizationVariant>('galaxy');

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

  const timeline = useTimelineReplay();
  const rawDisplayEvents = timeline.active ? timeline.replayEvents : liveEvents;
  const animationMapRef = timeline.active ? timeline.animationMapRef : liveAnimMapRef;
  const animTick = timeline.active ? timeline.animTick : liveAnimTick;

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
        title={t.overview.realtime_page.title}
        subtitle={
          timeline.active
            ? (timeline.range === '1d' ? tx(t.overview.realtime_page.replay_subtitle_1d, { speed: timeline.speed }) : tx(t.overview.realtime_page.replay_subtitle_7d, { speed: timeline.speed }))
            : t.overview.realtime_page.live_subtitle
        }
        actions={
          <div className="flex items-center gap-1 bg-secondary/30 border border-primary/10 rounded-modal p-0.5">
            {(Object.entries(VARIANT_META) as [VisualizationVariant, (typeof VARIANT_META)[VisualizationVariant]][]).map(([key, m]) => {
              const Icon = m.icon;
              const isActive = variant === key;
              return (
                <button
                  key={key}
                  onClick={() => setVariant(key)}
                  title={m.description}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-code font-mono transition-all ${
                    isActive
                      ? 'bg-primary/10 text-foreground/90 shadow-elevation-1'
                      : 'text-foreground hover:text-muted-foreground/80 hover:bg-secondary/50'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
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
        {variant === 'galaxy' && (
          <EventBusVisualization events={displayEvents} personas={personaInfos} droppedCount={timeline.active ? 0 : droppedCount} animationMapRef={animationMapRef} animTick={animTick} onSelectEvent={selectEvent} onTestFlow={triggerTestFlow} />
        )}
        {variant === 'lanes' && (
          <SwimLaneVisualization events={displayEvents} personas={personaInfos} droppedCount={timeline.active ? 0 : droppedCount} animationMapRef={animationMapRef} animTick={animTick} onSelectEvent={selectEvent} />
        )}
        {selectedEvent && <EventDetailDrawer event={selectedEvent} onClose={() => selectEvent(null)} />}
      </div>

      <TimelinePlayer {...timeline} onEnterReplay={timeline.enterReplay} onExitReplay={timeline.exitReplay} onTogglePlay={timeline.togglePlay} onSetSpeed={timeline.setSpeed} onSeek={timeline.seekTo} />
    </ContentBox>
  );
}
