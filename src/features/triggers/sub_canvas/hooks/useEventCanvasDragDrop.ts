import { useCallback, type DragEvent } from 'react';
import type { ReactFlowInstance, Node } from '@xyflow/react';
import {
  NODE_TYPE_EVENT_SOURCE,
  NODE_TYPE_PERSONA_CONSUMER,
  GRID_SIZE,
  findTemplateByEventType,
  DEFAULT_SOURCE_COLOR,
} from '../libs/eventCanvasConstants';
import type { EventSourceNodeData, PersonaConsumerNodeData } from '../libs/eventCanvasReconcile';

export const DRAG_TYPE_EVENT_SOURCE = 'application/event-source-id';
export const DRAG_TYPE_PERSONA = 'application/persona-consumer-id';

interface UseEventCanvasDragDropOpts {
  reactFlowInstance: ReactFlowInstance | null;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  personas: Array<{ id: string; name: string; icon: string | null; color: string | null; enabled: boolean }>;
}

export function useEventCanvasDragDrop({
  reactFlowInstance,
  setNodes,
  personas,
}: UseEventCanvasDragDropOpts) {

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (!reactFlowInstance) return;

    const position = reactFlowInstance.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    });
    // Snap to grid
    position.x = Math.round(position.x / GRID_SIZE) * GRID_SIZE;
    position.y = Math.round(position.y / GRID_SIZE) * GRID_SIZE;

    // Check for event source drop
    const eventSourceId = e.dataTransfer.getData(DRAG_TYPE_EVENT_SOURCE);
    if (eventSourceId) {
      const template = findTemplateByEventType(eventSourceId);
      const nodeId = `src-${eventSourceId}`;

      const newNode: Node = {
        id: nodeId,
        type: NODE_TYPE_EVENT_SOURCE,
        position,
        data: {
          eventType: eventSourceId,
          label: template?.label ?? eventSourceId,
          iconName: template?.icon?.displayName ?? 'Zap',
          color: template?.color ?? DEFAULT_SOURCE_COLOR,
          sourceFilter: template?.sourceFilter,
          liveEventCount: 0,
          lastEventAt: null,
        } satisfies EventSourceNodeData,
      };

      setNodes(prev => {
        // Don't add duplicate source nodes for the same event type
        if (prev.some(n => n.id === nodeId)) return prev;
        return [...prev, newNode];
      });
      return;
    }

    // Check for persona drop
    const personaId = e.dataTransfer.getData(DRAG_TYPE_PERSONA);
    if (personaId) {
      const persona = personas.find(p => p.id === personaId);
      if (!persona) return;

      const newNode: Node = {
        id: personaId,
        type: NODE_TYPE_PERSONA_CONSUMER,
        position,
        data: {
          personaId,
          name: persona.name,
          icon: persona.icon ?? '',
          color: persona.color ?? 'text-blue-400',
          enabled: persona.enabled,
          lastExecutionAt: null,
          executionStatus: null,
          connectedEventCount: 0,
        } satisfies PersonaConsumerNodeData,
      };

      setNodes(prev => {
        // Don't add duplicate persona nodes
        if (prev.some(n => n.id === personaId)) return prev;
        return [...prev, newNode];
      });
    }
  }, [reactFlowInstance, setNodes, personas]);

  return { onDragOver, onDrop };
}
