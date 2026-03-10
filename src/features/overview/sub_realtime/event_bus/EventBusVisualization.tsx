import { useId } from 'react';
import type { Props } from './state/EventBusTypes';
import { useEventBusState } from '../useEventBusState';
import { EventBusSvgDefs } from './rendering/EventBusSvgDefs';
import { ToolNodeGroup, PersonaNodeGroup } from './rendering/EventBusNodes';
import { InboundParticles, ReturnFlowParticles } from './rendering/EventBusParticles';
import { EventBusBadges } from './rendering/EventBusBadges';
import { EventBusOverlays } from './rendering/EventBusOverlays';

export type { DiscoveredSource } from '../libs/visualizationHelpers';

export default function EventBusVisualization({ events, personas, droppedCount = 0, onSelectEvent }: Props) {
  const uid = useId();
  const {
    discoveredSourcesRef,
    toolNodes,
    personaNodes,
    activeEvents,
    seenTypes,
    inFlightCount,
    getSourcePos,
    getTargetPos,
    processingSet,
    returnFlows,
    hasTraffic,
  } = useEventBusState(events, personas);

  return (
    <div className="w-full h-full relative min-h-[280px]">
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <EventBusSvgDefs uid={uid} hasTraffic={hasTraffic} />
        <ToolNodeGroup nodes={toolNodes} />
        <PersonaNodeGroup nodes={personaNodes} processingSet={processingSet} />
        <InboundParticles
          activeEvents={activeEvents}
          uid={uid}
          getSourcePos={getSourcePos}
          getTargetPos={getTargetPos}
          onSelectEvent={onSelectEvent}
        />
        <ReturnFlowParticles flows={returnFlows} uid={uid} />
        <EventBusBadges
          inFlightCount={inFlightCount}
          discoveredSourcesRef={discoveredSourcesRef}
          agentCount={personaNodes.length}
        />
      </svg>

      <EventBusOverlays
        seenTypes={seenTypes}
        droppedCount={droppedCount}
        isEmpty={events.length === 0}
      />
    </div>
  );
}
