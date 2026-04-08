import { useCallback } from 'react';
import type { Connection, Node, Edge } from '@xyflow/react';
import { createTrigger, deleteTrigger } from '@/api/pipeline/triggers';
import { createLogger } from "@/lib/log";

const logger = createLogger("event-canvas");
import {
  NODE_TYPE_EVENT_SOURCE,
  NODE_TYPE_PERSONA_CONSUMER,
} from '../libs/eventCanvasConstants';
import type { EventSourceNodeData, PersonaConsumerNodeData } from '../libs/eventCanvasReconcile';
import type { EventEdgeData } from '../edges/EventEdge';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseEventCanvasActionsOpts {
  nodes: Node[];
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onTriggerChanged: () => void;
}

export function useEventCanvasActions({
  nodes,
  edges,
  setEdges,
  onTriggerChanged,
}: UseEventCanvasActionsOpts) {

  /** Only allow edges from eventSource -> personaConsumer */
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;
    if (sourceNode.type !== NODE_TYPE_EVENT_SOURCE) return false;
    if (targetNode.type !== NODE_TYPE_PERSONA_CONSUMER) return false;

    // Prevent duplicate edges (same source -> same target)
    const exists = edges.some(
      e => e.source === connection.source && e.target === connection.target,
    );
    return !exists;
  }, [nodes, edges]);

  /** Draw edge = create event_listener trigger */
  const onConnect = useCallback(async (connection: Connection) => {
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return;

    const sourceData = sourceNode.data as EventSourceNodeData;
    const targetData = targetNode.data as PersonaConsumerNodeData;

    const config: Record<string, string> = {
      listen_event_type: sourceData.eventType,
    };
    if (sourceData.sourceFilter) {
      config.source_filter = sourceData.sourceFilter;
    }

    try {
      const trigger = await createTrigger({
        persona_id: targetData.personaId,
        trigger_type: 'event_listener',
        config: JSON.stringify(config),
        enabled: true,
        use_case_id: null,
      });

      // Add edge with trigger reference
      const newEdge: Edge = {
        id: `edge-${trigger.id}`,
        source: connection.source!,
        target: connection.target!,
        type: 'eventEdge',
        data: {
          triggerId: trigger.id,
          eventType: sourceData.eventType,
          sourceFilter: sourceData.sourceFilter ?? null,
        } satisfies EventEdgeData,
      };
      setEdges(prev => [...prev, newEdge]);
      onTriggerChanged();
    } catch (err) {
      logger.error('Failed to create trigger', { error: String(err) });
    }
  }, [nodes, setEdges, onTriggerChanged]);

  /** Delete edge = delete trigger */
  const onDeleteEdge = useCallback(async (edgeId: string) => {
    const edge = edges.find(e => e.id === edgeId);
    if (!edge) return;

    const d = edge.data as EventEdgeData | undefined;
    if (!d?.triggerId) return;

    // Find persona ID from target node
    const targetNode = nodes.find(n => n.id === edge.target);
    const personaId = targetNode
      ? (targetNode.data as PersonaConsumerNodeData).personaId
      : edge.target;

    try {
      await deleteTrigger(d.triggerId, personaId);
      setEdges(prev => prev.filter(e => e.id !== edgeId));
      onTriggerChanged();
    } catch (err) {
      logger.error('Failed to delete trigger', { edgeId, error: String(err) });
    }
  }, [edges, nodes, setEdges, onTriggerChanged]);

  /** Delete a node and cascade-delete all connected edges/triggers */
  const onDeleteNode = useCallback(async (nodeId: string) => {
    const connectedEdges = edges.filter(
      e => e.source === nodeId || e.target === nodeId,
    );
    // Delete all associated triggers
    for (const edge of connectedEdges) {
      await onDeleteEdge(edge.id);
    }
  }, [edges, onDeleteEdge]);

  return {
    isValidConnection,
    onConnect,
    onDeleteEdge,
    onDeleteNode,
  };
}
