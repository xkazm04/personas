import { useCallback, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import {
  NODE_TYPE_EVENT_SOURCE,
  NODE_TYPE_PERSONA_CONSUMER,
  GRID_SIZE,
  findTemplateByEventType,
  DEFAULT_SOURCE_COLOR,
} from '../libs/eventCanvasConstants';
import type { EventSourceNodeData, PersonaConsumerNodeData } from '../libs/eventCanvasReconcile';

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const pendingItem: { type: 'event' | 'persona' | null; value: string; label: string } = {
  type: null,
  value: '',
  label: '',
};

export function setPendingItem(type: 'event' | 'persona', value: string, label?: string) {
  pendingItem.type = type;
  pendingItem.value = value;
  pendingItem.label = label ?? value;
}

export function clearPendingItem() {
  pendingItem.type = null;
  pendingItem.value = '';
  pendingItem.label = '';
}

export function hasPendingItem() {
  return pendingItem.type !== null;
}

export function getPendingLabel() {
  return pendingItem.label || pendingItem.value || '';
}

/** True when variant B pointer drag is actively tracking */
let pointerDragActive = false;
export function isPointerDragging() { return pointerDragActive; }

// ---------------------------------------------------------------------------
// Node creation helper
// ---------------------------------------------------------------------------

interface Opts {
  /** From useReactFlow() — always available inside ReactFlowProvider */
  reactFlowInstance: { screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number } };
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  personas: Array<{ id: string; name: string; icon: string | null; color: string | null; enabled: boolean }>;
}

function buildNode(
  position: { x: number; y: number },
  personas: Opts['personas'],
): Node | null {
  if (!pendingItem.type) return null;

  const snapped = {
    x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
  };

  if (pendingItem.type === 'event') {
    const id = pendingItem.value;
    const template = findTemplateByEventType(id);
    return {
      id: `src-${id}`,
      type: NODE_TYPE_EVENT_SOURCE,
      position: snapped,
      data: {
        eventType: id,
        label: template?.label ?? id,
        iconName: template?.icon?.displayName ?? 'Zap',
        color: template?.color ?? DEFAULT_SOURCE_COLOR,
        sourceFilter: template?.sourceFilter,
        liveEventCount: 0,
        lastEventAt: null,
      } satisfies EventSourceNodeData,
    };
  }

  if (pendingItem.type === 'persona') {
    const persona = personas.find(p => p.id === pendingItem.value);
    if (!persona) return null;
    return {
      id: persona.id,
      type: NODE_TYPE_PERSONA_CONSUMER,
      position: snapped,
      data: {
        personaId: persona.id,
        name: persona.name,
        icon: persona.icon ?? '',
        color: persona.color ?? 'text-blue-400',
        enabled: persona.enabled,
        lastExecutionAt: null,
        executionStatus: null,
        connectedEventCount: 0,
      } satisfies PersonaConsumerNodeData,
    };
  }

  return null;
}

function addIfNew(setNodes: React.Dispatch<React.SetStateAction<Node[]>>, node: Node) {
  setNodes(prev => prev.some(n => n.id === node.id) ? prev : [...prev, node]);
}

// ==========================================================================
// VARIANT B: Pointer-tracking manual DnD
// On sidebar mousedown: record item + track mouse globally.
// Render a floating ghost node following the cursor.
// On mouseup over canvas: place node at that position.
// Fully custom — no browser DnD API at all.
// ==========================================================================

export function useDndVariantB({ reactFlowInstance, setNodes, personas }: Opts) {
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const activeRef = useRef(false);
  // Use refs so the pointer event callbacks always read latest values
  const rfRef = useRef(reactFlowInstance);
  rfRef.current = reactFlowInstance;
  const personasRef = useRef(personas);
  personasRef.current = personas;
  const setNodesRef = useRef(setNodes);
  setNodesRef.current = setNodes;

  const startDrag = useCallback((type: 'event' | 'persona', value: string, label: string) => {
    setPendingItem(type, value, label);
    activeRef.current = true;
    pointerDragActive = true;

    function onMove(e: PointerEvent) {
      setGhost({ x: e.clientX, y: e.clientY, label });
    }

    function onUp(e: PointerEvent) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGhost(null);
      activeRef.current = false;
      pointerDragActive = false;

      const rf = rfRef.current;
      if (!rf) { clearPendingItem(); return; }

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const isOverCanvas = el?.closest('.react-flow') !== null;

      if (isOverCanvas) {
        const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const node = buildNode(pos, personasRef.current);
        if (node) addIfNew(setNodesRef.current, node);
      }
      clearPendingItem();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []); // stable — reads from refs

  return { startDrag, ghost };
}

// ==========================================================================
// VARIANT C: Click-to-place (proven working)
// ==========================================================================

export function useDndVariantC({ reactFlowInstance, setNodes, personas }: Opts) {
  const onPaneClickPlace = useCallback((e: React.MouseEvent) => {
    if (!pendingItem.type || !reactFlowInstance) return;

    const pos = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const node = buildNode(pos, personas);
    if (node) addIfNew(setNodes, node);
    clearPendingItem();
  }, [reactFlowInstance, setNodes, personas]);

  return { onPaneClickPlace };
}

// ==========================================================================
// CLICK-TO-CONNECT: Alternative to handle-dragging for edge creation
// Click a source node handle, then click a target node handle.
// ==========================================================================

export interface ConnectPending {
  sourceNodeId: string;
  sourceType: string;
}

export function useClickToConnect() {
  const [pending, setPending] = useState<ConnectPending | null>(null);

  const startConnect = useCallback((sourceNodeId: string, sourceType: string) => {
    setPending({ sourceNodeId, sourceType });
  }, []);

  const cancelConnect = useCallback(() => {
    setPending(null);
  }, []);

  return { connectPending: pending, startConnect, cancelConnect, setConnectPending: setPending };
}
