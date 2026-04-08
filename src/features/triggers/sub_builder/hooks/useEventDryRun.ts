import { useCallback, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { DryRunState } from './useEventCanvasState';
import { NODE_TYPE_EVENT_SOURCE } from '../libs/eventCanvasConstants';
import type { EventSourceNodeData } from '../libs/eventCanvasReconcile';

interface UseEventDryRunOpts {
  nodes: Node[];
  edges: Edge[];
  onStateChange: (state: DryRunState | null) => void;
}

/**
 * Manages dry-run stepping through event flow on the canvas.
 *
 * Flow: select event source → step through each connected edge/persona → done.
 * Each step highlights the active edge/node in amber, completed in green.
 */
export function useEventDryRun({ nodes, edges, onStateChange }: UseEventDryRunOpts) {
  const stateRef = useRef<DryRunState | null>(null);

  /** Build the step sequence for a given event type */
  const buildSteps = useCallback((eventType: string): Array<{ edgeId: string; targetNodeId: string }> => {
    const sourceNodeId = nodes.find(
      n => n.type === NODE_TYPE_EVENT_SOURCE && (n.data as EventSourceNodeData).eventType === eventType,
    )?.id;
    if (!sourceNodeId) return [];

    return edges
      .filter(e => e.source === sourceNodeId)
      .map(e => ({ edgeId: e.id, targetNodeId: e.target }));
  }, [nodes, edges]);

  const start = useCallback((eventType: string) => {
    const steps = buildSteps(eventType);
    const state: DryRunState = {
      active: true,
      eventType,
      currentStep: -1, // -1 = source highlighted, 0+ = edges
      totalSteps: steps.length,
      completedEdges: new Set(),
      activeEdge: null,
      completedNodes: new Set(),
      activeNode: nodes.find(
        n => n.type === NODE_TYPE_EVENT_SOURCE && (n.data as EventSourceNodeData).eventType === eventType,
      )?.id ?? null,
    };
    stateRef.current = state;
    onStateChange(state);
  }, [nodes, buildSteps, onStateChange]);

  const step = useCallback(() => {
    const prev = stateRef.current;
    if (!prev || !prev.active) return;

    const steps = buildSteps(prev.eventType);
    const nextIdx = prev.currentStep + 1;

    if (nextIdx >= steps.length) {
      // All done
      const done: DryRunState = {
        ...prev,
        currentStep: nextIdx,
        activeEdge: null,
        activeNode: null,
        completedNodes: new Set([...prev.completedNodes, ...(prev.activeNode ? [prev.activeNode] : [])]),
        completedEdges: new Set([...prev.completedEdges, ...(prev.activeEdge ? [prev.activeEdge] : [])]),
      };
      stateRef.current = done;
      onStateChange(done);
      return;
    }

    const nextStep = steps[nextIdx]!;
    const completed = new Set(prev.completedEdges);
    const completedN = new Set(prev.completedNodes);
    if (prev.activeEdge) completed.add(prev.activeEdge);
    if (prev.activeNode) completedN.add(prev.activeNode);

    const next: DryRunState = {
      ...prev,
      currentStep: nextIdx,
      activeEdge: nextStep.edgeId,
      activeNode: nextStep.targetNodeId,
      completedEdges: completed,
      completedNodes: completedN,
    };
    stateRef.current = next;
    onStateChange(next);
  }, [buildSteps, onStateChange]);

  const stop = useCallback(() => {
    stateRef.current = null;
    onStateChange(null);
  }, [onStateChange]);

  /** Get available event types for the dropdown */
  const availableEventTypes = nodes
    .filter(n => n.type === NODE_TYPE_EVENT_SOURCE)
    .map(n => (n.data as EventSourceNodeData).eventType);

  return { start, step, stop, availableEventTypes };
}
