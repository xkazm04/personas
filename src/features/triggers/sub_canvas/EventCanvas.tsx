import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { PanelLeft, PanelLeftClose, RotateCcw, Trash2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { listAllTriggers } from '@/api/pipeline/triggers';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

import { EventSourceNode } from './nodes/EventSourceNode';
import { PersonaConsumerNode } from './nodes/PersonaConsumerNode';
import { EventEdge } from './edges/EventEdge';
import { SystemEventsToolbar } from './palettes/EventSourcePalette';
import { PersonaPalette } from './palettes/PersonaPalette';
import { useEventCanvasState } from './hooks/useEventCanvasState';
import { useEventCanvasActions } from './hooks/useEventCanvasActions';
import { useEventCanvasDragDrop } from './hooks/useEventCanvasDragDrop';
import {
  NODE_TYPE_EVENT_SOURCE,
  NODE_TYPE_PERSONA_CONSUMER,
  GRID_SIZE,
} from './libs/eventCanvasConstants';
import {
  reconcileCanvasWithTriggers,
  saveLayout,
  type EventSourceNodeData,
} from './libs/eventCanvasReconcile';

// Register custom node/edge types (must be stable refs outside component)
const nodeTypes = {
  [NODE_TYPE_EVENT_SOURCE]: EventSourceNode,
  [NODE_TYPE_PERSONA_CONSUMER]: PersonaConsumerNode,
};
const edgeTypes = {
  eventEdge: EventEdge,
};

// Hide ReactFlow attribution
const proOptions = { hideAttribution: true };

interface Props {
  allTriggers: PersonaTrigger[];
}

// ---------------------------------------------------------------------------
// Context menu state
// ---------------------------------------------------------------------------
interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
  nodeLabel: string;
}

export function EventCanvas({ allTriggers: initialTriggers }: Props) {
  const personas = useAgentStore(s => s.personas);
  const [cs, dispatch] = useEventCanvasState();
  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>(initialTriggers);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Debounced layout save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDebounced = useCallback((n: Node[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveLayout(n), 800);
  }, []);

  // Save layout whenever nodes change position
  useEffect(() => {
    if (nodes.length > 0) saveDebounced(nodes);
  }, [nodes, saveDebounced]);

  // ---------------------------------------------------------------------------
  // Load & reconcile on mount
  // ---------------------------------------------------------------------------
  const loadCanvas = useCallback(async () => {
    try {
      const triggers = await listAllTriggers();
      setAllTriggers(triggers);
      const { nodes: n, edges: e } = reconcileCanvasWithTriggers(triggers, personas);
      setNodes(n);
      setEdges(e);
    } catch (err) {
      console.error('[EventCanvas] Failed to load:', err);
    }
  }, [personas, setNodes, setEdges]);

  useEffect(() => { void loadCanvas(); }, [loadCanvas]);

  // ---------------------------------------------------------------------------
  // Canvas actions (connect/disconnect -> trigger CRUD)
  // ---------------------------------------------------------------------------
  const { isValidConnection, onConnect, onDeleteEdge, onDeleteNode } = useEventCanvasActions({
    nodes,
    edges,
    setEdges,
    onTriggerChanged: () => { void loadCanvas(); },
  });

  // ---------------------------------------------------------------------------
  // Drag & drop from palettes
  // ---------------------------------------------------------------------------
  const { onDragOver, onDrop } = useEventCanvasDragDrop({
    reactFlowInstance: cs.reactFlowInstance,
    setNodes,
    personas,
  });

  // ---------------------------------------------------------------------------
  // Live event count updates
  // ---------------------------------------------------------------------------
  useEventBusListener(useCallback((event: { event_type?: string }) => {
    if (event.event_type) {
      dispatch({ type: 'INCREMENT_LIVE_COUNT', eventType: event.event_type });
    }
  }, [dispatch]));

  useEffect(() => {
    const counts = cs.liveEventCounts;
    if (Object.keys(counts).length === 0) return;
    setNodes(prev =>
      prev.map(n => {
        if (n.type !== NODE_TYPE_EVENT_SOURCE) return n;
        const d = n.data as EventSourceNodeData;
        const count = counts[d.eventType] ?? 0;
        if (count === d.liveEventCount) return n;
        return { ...n, data: { ...d, liveEventCount: count } };
      }),
    );
  }, [cs.liveEventCounts, setNodes]);

  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'RESET_LIVE_COUNTS' }), 60_000);
    return () => clearInterval(interval);
  }, [dispatch]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const onCanvasEventTypes = useMemo(
    () => new Set(nodes.filter(n => n.type === NODE_TYPE_EVENT_SOURCE).map(n => (n.data as EventSourceNodeData).eventType)),
    [nodes],
  );
  const onCanvasPersonaIds = useMemo(
    () => new Set(nodes.filter(n => n.type === NODE_TYPE_PERSONA_CONSUMER).map(n => n.id)),
    [nodes],
  );

  // ---------------------------------------------------------------------------
  // Edge delete via keyboard
  // ---------------------------------------------------------------------------
  const onEdgesDelete = useCallback(async (deletedEdges: typeof edges) => {
    for (const edge of deletedEdges) {
      await onDeleteEdge(edge.id);
    }
  }, [onDeleteEdge]);

  // ---------------------------------------------------------------------------
  // Right-click context menu
  // ---------------------------------------------------------------------------
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const label = node.type === NODE_TYPE_EVENT_SOURCE
      ? (node.data as EventSourceNodeData).label
      : (node.data as { name?: string }).name ?? node.id;
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, nodeLabel: label });
  }, []);

  const onPaneClick = useCallback(() => { setContextMenu(null); }, []);

  const handleContextMenuRemove = useCallback(async () => {
    if (!contextMenu) return;
    const node = nodes.find(n => n.id === contextMenu.nodeId);
    if (!node) return;
    await onDeleteNode(contextMenu.nodeId);
    setNodes(prev => prev.filter(n => n.id !== contextMenu.nodeId));
    setContextMenu(null);
  }, [contextMenu, nodes, onDeleteNode, setNodes]);

  // ---------------------------------------------------------------------------
  // Marketplace sidebar content (inline)
  // ---------------------------------------------------------------------------
  const marketplaceContent = useMemo(() => (
    <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="text-[11px] text-muted-foreground/60">
        Browse shared event feeds in the Marketplace tab.
        Subscribed feeds appear as draggable event sources here.
      </p>
    </div>
  ), []);

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left sidebar — Personas + Marketplace */}
      {!cs.paletteCollapsed && (
        <div className="w-64 border-r border-primary/10 flex flex-col overflow-hidden bg-card/30">
          <PersonaPalette
            personas={personas}
            triggers={allTriggers}
            onCanvasPersonaIds={onCanvasPersonaIds}
            onCanvasEventTypes={onCanvasEventTypes}
            marketplaceContent={marketplaceContent}
          />
        </div>
      )}

      {/* Canvas area */}
      <div className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
        {/* Top-left toolbar */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
          <button
            onClick={() => dispatch({ type: 'TOGGLE_PALETTE' })}
            className="p-1.5 rounded-md bg-card/80 backdrop-blur border border-primary/10 hover:bg-secondary/60 transition-colors"
            title={cs.paletteCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {cs.paletteCollapsed
              ? <PanelLeft className="w-3.5 h-3.5 text-muted-foreground" />
              : <PanelLeftClose className="w-3.5 h-3.5 text-muted-foreground" />
            }
          </button>
          <button
            onClick={() => void loadCanvas()}
            className="p-1.5 rounded-md bg-card/80 backdrop-blur border border-primary/10 hover:bg-secondary/60 transition-colors"
            title="Refresh from triggers"
          >
            <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Top center — System Events toolbar */}
        <SystemEventsToolbar onCanvasEventTypes={onCanvasEventTypes} />

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          isValidConnection={isValidConnection}
          onInit={instance => dispatch({ type: 'SET_REACT_FLOW_INSTANCE', instance })}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'eventEdge' }}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={proOptions}
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} className="opacity-30" />
          <Controls
            showInteractive={false}
            position="bottom-right"
            className="!bg-card/80 !border-primary/10 !shadow-sm"
          />
        </ReactFlow>

        {/* Context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[160px] rounded-lg bg-popover/95 backdrop-blur-md border border-primary/10 shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-1.5 border-b border-primary/5">
              <span className="text-[10px] text-muted-foreground/60 truncate block max-w-[140px]">
                {contextMenu.nodeLabel}
              </span>
            </div>
            <button
              onClick={handleContextMenuRemove}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Remove from canvas
            </button>
          </div>
        )}

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-sm text-muted-foreground/60 mb-1">
                Drag personas from the sidebar and connect them with events
              </p>
              <p className="text-xs text-muted-foreground/40">
                System events available in the toolbar above
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
