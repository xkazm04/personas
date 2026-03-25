import { useCallback } from 'react';
import type { ReactFlowInstance, Node } from '@xyflow/react';
import {
  NODE_TYPE_EVENT_SOURCE,
  NODE_TYPE_PERSONA_CONSUMER,
  GRID_SIZE,
  findTemplateByEventType,
  DEFAULT_SOURCE_COLOR,
} from '../libs/eventCanvasConstants';
import type { EventSourceNodeData, PersonaConsumerNodeData } from '../libs/eventCanvasReconcile';

// ---------------------------------------------------------------------------
// Module-level drag payload.
// Browser DnD restricts dataTransfer.getData() during dragover — only the
// `types` array and `effectAllowed` are readable. We use a module ref
// to carry the full payload from dragStart to drop.
// ---------------------------------------------------------------------------

const dragPayload: { type: 'event' | 'persona' | null; value: string } = {
  type: null,
  value: '',
};

export function setDragPayload(type: 'event' | 'persona', value: string) {
  dragPayload.type = type;
  dragPayload.value = value;
}

export function clearDragPayload() {
  dragPayload.type = null;
  dragPayload.value = '';
}

// Custom MIME type set in dataTransfer.types — readable during dragover
export const CANVAS_DND_MIME = 'application/x-event-canvas';

// ---------------------------------------------------------------------------
// Hook — returns onDragOver + onDrop to pass as props to <ReactFlow>
// ReactFlow v12 spreads ...rest onto its wrapper div, so these become
// native DOM event handlers on the actual element.
// ---------------------------------------------------------------------------

interface Opts {
  reactFlowInstance: ReactFlowInstance | null;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  personas: Array<{ id: string; name: string; icon: string | null; color: string | null; enabled: boolean }>;
}

export function useEventCanvasDragDrop({ reactFlowInstance, setNodes, personas }: Opts) {
  const onDragOver = useCallback((e: React.DragEvent) => {
    // Only allow drop if it's our custom canvas DnD (not ReactFlow internal node drag)
    if (!e.dataTransfer.types.includes(CANVAS_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(CANVAS_DND_MIME)) return;
    e.preventDefault();

    if (!reactFlowInstance || !dragPayload.type) {
      clearDragPayload();
      return;
    }

    const position = reactFlowInstance.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    });
    position.x = Math.round(position.x / GRID_SIZE) * GRID_SIZE;
    position.y = Math.round(position.y / GRID_SIZE) * GRID_SIZE;

    if (dragPayload.type === 'event') {
      const eventSourceId = dragPayload.value;
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

      setNodes(prev => prev.some(n => n.id === nodeId) ? prev : [...prev, newNode]);
    }

    if (dragPayload.type === 'persona') {
      const personaId = dragPayload.value;
      const persona = personas.find(p => p.id === personaId);
      if (persona) {
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

        setNodes(prev => prev.some(n => n.id === personaId) ? prev : [...prev, newNode]);
      }
    }

    clearDragPayload();
  }, [reactFlowInstance, setNodes, personas]);

  return { onDragOver, onDrop };
}
