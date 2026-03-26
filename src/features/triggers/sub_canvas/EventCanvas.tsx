import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type Connection, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  PanelLeft, PanelLeftClose, RotateCcw, Trash2, Zap, Play,
  Link2, X, LayoutGrid, StickyNote, Sparkles, FlaskConical,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { listAllTriggers, createTrigger, deleteTrigger, updateTrigger } from '@/api/pipeline/triggers';
import { testEventFlow } from '@/api/overview/events';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

import { EventSourceNode } from './nodes/EventSourceNode';
import { PersonaConsumerNode } from './nodes/PersonaConsumerNode';
import { StickyNoteNode, type StickyNoteCategory } from './nodes/StickyNoteNode';
import { EventEdge, type EventEdgeData } from './edges/EventEdge';
import { EdgeTooltip } from './edges/EdgeTooltip';
import { SystemEventsToolbar } from './palettes/EventSourcePalette';
import { PersonaPalette } from './palettes/PersonaPalette';
import { useEventCanvasState, type StickyNote as StickyNoteType } from './hooks/useEventCanvasState';
import { useEventDryRun } from './hooks/useEventDryRun';
import { EventDryRunBar } from './debugger/EventDryRunBar';
import { EventCanvasAssistant } from './assistant/EventCanvasAssistant';
import { computeAutoLayout } from './libs/eventCanvasAutoLayout';
import {
  useDndVariantB, useDndVariantC,
  hasPendingItem, clearPendingItem, getPendingLabel,
  isPointerDragging, useClickToConnect,
} from './hooks/useEventCanvasDragDrop';
import {
  NODE_TYPE_EVENT_SOURCE, NODE_TYPE_PERSONA_CONSUMER, NODE_TYPE_STICKY_NOTE, GRID_SIZE,
} from './libs/eventCanvasConstants';
import {
  reconcileCanvasWithTriggers, saveLayout,
  type EventSourceNodeData, type PersonaConsumerNodeData, type SavedStickyNote,
} from './libs/eventCanvasReconcile';

const nodeTypes = {
  [NODE_TYPE_EVENT_SOURCE]: EventSourceNode,
  [NODE_TYPE_PERSONA_CONSUMER]: PersonaConsumerNode,
  [NODE_TYPE_STICKY_NOTE]: StickyNoteNode,
};
const edgeTypes = { eventEdge: EventEdge };
const proOptions = { hideAttribution: true };

interface Props { allTriggers: PersonaTrigger[] }
interface ContextMenu { x: number; y: number; nodeId: string; nodeType: string; nodeLabel: string; eventType?: string }

export function EventCanvas(props: Props) {
  return <ReactFlowProvider><EventCanvasInner {...props} /></ReactFlowProvider>;
}

function EventCanvasInner({ allTriggers: initialTriggers }: Props) {
  const personas = useAgentStore(s => s.personas);
  const reactFlowInstance = useReactFlow();
  const [cs, dispatch] = useEventCanvasState();
  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>(initialTriggers);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [testFiring, setTestFiring] = useState(false);
  const [, forceRender] = useState(0);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { connectPending, startConnect, cancelConnect } = useClickToConnect();

  // Save layout debounced
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (nodes.length > 0 || cs.stickyNotes.length > 0) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const sn: SavedStickyNote[] = cs.stickyNotes.map(n => ({ id: n.id, x: n.x, y: n.y, text: n.text, category: n.category }));
        saveLayout(nodes, sn);
      }, 800);
    }
  }, [nodes, cs.stickyNotes]);

  // Load
  const loadCanvas = useCallback(async () => {
    try {
      const triggers = await listAllTriggers();
      setAllTriggers(triggers);
      const { nodes: n, edges: e } = reconcileCanvasWithTriggers(triggers, personas);
      setNodes(n); setEdges(e);
      const raw = localStorage.getItem('event_canvas_layout');
      if (raw) { try { const l = JSON.parse(raw); if (l.stickyNotes?.length) dispatch({ type: 'SET_STICKY_NOTES', notes: l.stickyNotes }); } catch {} }
    } catch (err) { console.error('[EventCanvas] Failed to load:', err); }
  }, [personas, setNodes, setEdges, dispatch]);

  useEffect(() => { void loadCanvas(); }, [loadCanvas]);

  // Connection
  const createConnection = useCallback(async (sourceId: string, targetId: string) => {
    const src = nodes.find(n => n.id === sourceId);
    const tgt = nodes.find(n => n.id === targetId);
    if (!src || !tgt) return;
    if (src.type !== NODE_TYPE_EVENT_SOURCE || tgt.type !== NODE_TYPE_PERSONA_CONSUMER) return;
    if (edges.some(e => e.source === sourceId && e.target === targetId)) return;

    const sd = src.data as EventSourceNodeData;
    const td = tgt.data as PersonaConsumerNodeData;
    const config: Record<string, string> = { listen_event_type: sd.eventType };
    if (sd.sourceFilter) config.source_filter = sd.sourceFilter;

    try {
      const trigger = await createTrigger({ persona_id: td.personaId, trigger_type: 'event_listener', config: JSON.stringify(config), enabled: true, use_case_id: null });
      setEdges(prev => [...prev, {
        id: `edge-${trigger.id}`, source: sourceId, target: targetId, type: 'eventEdge',
        data: { triggerId: trigger.id, eventType: sd.eventType, sourceFilter: sd.sourceFilter ?? null, conditionType: 'always' } satisfies EventEdgeData,
      }]);
    } catch (err) { console.error('[EventCanvas] Failed to create trigger:', err); }
  }, [nodes, edges, setEdges]);

  const onConnect = useCallback((c: Connection) => { if (c.source && c.target) void createConnection(c.source, c.target); }, [createConnection]);
  const isValidConnection = useCallback((c: Edge | Connection) => {
    const s = nodes.find(n => n.id === c.source), t = nodes.find(n => n.id === c.target);
    return !!s && !!t && s.type === NODE_TYPE_EVENT_SOURCE && t.type === NODE_TYPE_PERSONA_CONSUMER;
  }, [nodes]);

  // DnD — both modes always active
  const dndOpts = { reactFlowInstance, setNodes, personas };
  const variantB = useDndVariantB(dndOpts);
  const variantC = useDndVariantC(dndOpts);

  // Live counts
  useEventBusListener(useCallback((event: { event_type?: string }) => {
    if (event.event_type) dispatch({ type: 'INCREMENT_LIVE_COUNT', eventType: event.event_type });
  }, [dispatch]));

  useEffect(() => {
    const counts = cs.liveEventCounts;
    if (Object.keys(counts).length === 0) return;
    setNodes(prev => prev.map(n => {
      if (n.type !== NODE_TYPE_EVENT_SOURCE) return n;
      const d = n.data as EventSourceNodeData;
      const count = counts[d.eventType] ?? 0;
      return count === d.liveEventCount ? n : { ...n, data: { ...d, liveEventCount: count } };
    }));
  }, [cs.liveEventCounts, setNodes]);

  useEffect(() => {
    const i = setInterval(() => dispatch({ type: 'RESET_LIVE_COUNTS' }), 60_000);
    return () => clearInterval(i);
  }, [dispatch]);

  // Derived
  const onCanvasEventTypes = useMemo(() => new Set(nodes.filter(n => n.type === NODE_TYPE_EVENT_SOURCE).map(n => (n.data as EventSourceNodeData).eventType)), [nodes]);
  const onCanvasPersonaIds = useMemo(() => new Set(nodes.filter(n => n.type === NODE_TYPE_PERSONA_CONSUMER).map(n => n.id)), [nodes]);

  // Merge sticky notes
  const allNodes = useMemo(() => {
    const stickyNodes: Node[] = cs.stickyNotes.map(note => ({
      id: note.id, type: NODE_TYPE_STICKY_NOTE, position: { x: note.x, y: note.y },
      data: {
        text: note.text, category: note.category,
        onUpdate: (id: string, text: string, category: StickyNoteCategory) => dispatch({ type: 'UPDATE_STICKY_NOTE', id, text, category }),
        onDelete: (id: string) => { dispatch({ type: 'DELETE_STICKY_NOTE', id }); setNodes(prev => prev.filter(n => n.id !== id)); },
      },
    }));
    return [...nodes, ...stickyNodes];
  }, [nodes, cs.stickyNotes, dispatch, setNodes]);

  // Dry-run
  const dryRun = useEventDryRun({ nodes: allNodes, edges, onStateChange: (s) => dispatch({ type: 'SET_DRY_RUN_STATE', state: s }) });

  // Edge delete
  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    for (const e of deleted) {
      const d = e.data as EventEdgeData | undefined;
      if (d?.triggerId) { const tn = nodes.find(n => n.id === e.target); try { await deleteTrigger(d.triggerId, tn ? (tn.data as PersonaConsumerNodeData).personaId : e.target); } catch {} }
    }
    void loadCanvas();
  }, [nodes, loadCanvas]);

  // Node click — click-to-connect
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (connectPending) {
      if (node.type === NODE_TYPE_PERSONA_CONSUMER && connectPending.sourceType === NODE_TYPE_EVENT_SOURCE) void createConnection(connectPending.sourceNodeId, node.id);
      cancelConnect();
    }
  }, [connectPending, cancelConnect, createConnection]);

  // Context menu
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (node.type === NODE_TYPE_STICKY_NOTE) return;
    const isSource = node.type === NODE_TYPE_EVENT_SOURCE;
    const d = node.data as Record<string, unknown>;
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, nodeType: node.type ?? '', nodeLabel: isSource ? (d.label as string) : (d.name as string) ?? node.id, eventType: isSource ? (d.eventType as string) : undefined });
  }, []);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    setContextMenu(null);
    dispatch({ type: 'SET_EDGE_TOOLTIP', tooltip: null });
    if (connectPending) { cancelConnect(); return; }
    if (hasPendingItem() && !isPointerDragging()) {
      variantC.onPaneClickPlace(event);
      forceRender(n => n + 1);
    }
  }, [connectPending, cancelConnect, variantC, dispatch]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    dispatch({ type: 'SET_EDGE_TOOLTIP', tooltip: { x: _.clientX, y: _.clientY, edge } });
  }, [dispatch]);

  const handleRemove = useCallback(async () => {
    if (!contextMenu) return;
    const conn = edges.filter(e => e.source === contextMenu.nodeId || e.target === contextMenu.nodeId);
    for (const e of conn) { const d = e.data as EventEdgeData | undefined; if (d?.triggerId) { const tn = nodes.find(n => n.id === e.target); try { await deleteTrigger(d.triggerId, tn ? (tn.data as PersonaConsumerNodeData).personaId : e.target); } catch {} } }
    setNodes(prev => prev.filter(n => n.id !== contextMenu.nodeId));
    setEdges(prev => prev.filter(e => e.source !== contextMenu.nodeId && e.target !== contextMenu.nodeId));
    setContextMenu(null);
  }, [contextMenu, edges, nodes, setNodes, setEdges]);

  const handleConnectFromMenu = useCallback(() => { if (!contextMenu) return; startConnect(contextMenu.nodeId, contextMenu.nodeType); setContextMenu(null); }, [contextMenu, startConnect]);
  const handleTestFire = useCallback(async () => { if (!contextMenu?.eventType) return; setTestFiring(true); try { await testEventFlow(contextMenu.eventType, JSON.stringify({ _source: 'canvas_test' })); } catch {} finally { setTestFiring(false); setContextMenu(null); } }, [contextMenu]);

  // Edge tooltip
  const handleEdgeTypeChange = useCallback(async (newType: string) => {
    const t = cs.edgeTooltip; if (!t) return;
    const d = t.edge.data as EventEdgeData | undefined; if (!d?.triggerId) return;
    const cfg = { listen_event_type: d.eventType, source_filter: d.sourceFilter, condition_type: newType };
    try { await updateTrigger(d.triggerId, nodes.find(n => n.id === t.edge.target)?.id ?? t.edge.target, { config: JSON.stringify(cfg) }); setEdges(prev => prev.map(e => e.id === t.edge.id ? { ...e, data: { ...e.data, conditionType: newType } } : e)); } catch {}
    dispatch({ type: 'SET_EDGE_TOOLTIP', tooltip: null });
  }, [cs.edgeTooltip, nodes, setEdges, dispatch]);

  const handleEdgeDelete = useCallback(async () => { if (!cs.edgeTooltip) return; await onEdgesDelete([cs.edgeTooltip.edge]); dispatch({ type: 'SET_EDGE_TOOLTIP', tooltip: null }); }, [cs.edgeTooltip, onEdgesDelete, dispatch]);

  const handleAddNote = useCallback(() => { dispatch({ type: 'ADD_STICKY_NOTE', note: { id: `note-${Date.now()}`, x: 300, y: 200, text: '', category: 'documentation' } }); }, [dispatch]);
  const handleAutoLayout = useCallback(() => { setNodes(computeAutoLayout(nodes, edges)); }, [nodes, edges, setNodes]);

  const marketplaceContent = useMemo(() => <div className="flex flex-col items-center justify-center gap-2 p-4 text-center"><p className="text-[11px] text-muted-foreground/60">Browse shared event feeds in the Marketplace tab.</p></div>, []);

  // Show banner only for click-to-place (not during pointer drag)
  const showPlaceBanner = hasPendingItem() && !isPointerDragging();
  const showConnectBanner = !!connectPending;
  const showBanner = showPlaceBanner || showConnectBanner;

  return (
    <div className="flex-1 flex min-h-0">
      {!cs.paletteCollapsed && (
        <div className="w-64 border-r border-primary/10 flex flex-col overflow-hidden bg-card/30 z-20 relative">
          <PersonaPalette personas={personas} triggers={allTriggers} onCanvasPersonaIds={onCanvasPersonaIds} onCanvasEventTypes={onCanvasEventTypes} marketplaceContent={marketplaceContent} onStartPointerDrag={variantB.startDrag} />
        </div>
      )}

      <div className="flex-1 relative z-10">
        {/* Toolbar with labels */}
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1 flex-wrap">
          <button onClick={() => dispatch({ type: 'TOGGLE_PALETTE' })} className="p-1.5 rounded-md bg-card border border-primary/10 hover:bg-secondary/60 transition-colors" title={cs.paletteCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
            {cs.paletteCollapsed ? <PanelLeft className="w-3.5 h-3.5 text-muted-foreground" /> : <PanelLeftClose className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>

          <button onClick={() => void loadCanvas()} className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-card border border-primary/10 hover:bg-secondary/60 transition-colors text-muted-foreground" title="Refresh">
            <RotateCcw className="w-3.5 h-3.5" /><span className="text-[10px]">Refresh</span>
          </button>

          <button onClick={handleAutoLayout} className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-card border border-primary/10 hover:bg-secondary/60 transition-colors text-muted-foreground" title="Auto Layout">
            <LayoutGrid className="w-3.5 h-3.5" /><span className="text-[10px]">Layout</span>
          </button>

          <button onClick={handleAddNote} className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-card border border-primary/10 hover:bg-secondary/60 transition-colors" title="Add Sticky Note">
            <StickyNote className="w-3.5 h-3.5 text-amber-400" /><span className="text-[10px] text-muted-foreground">Note</span>
          </button>

          <button
            onClick={() => cs.dryRunState ? dryRun.stop() : dryRun.start(dryRun.availableEventTypes[0] || '')}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-md border transition-colors ${cs.dryRunState ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'bg-card border-primary/10 hover:bg-secondary/60 text-muted-foreground'}`}
            title={cs.dryRunState ? 'Stop Dry Run' : 'Start Dry Run'}
          >
            <FlaskConical className="w-3.5 h-3.5" /><span className="text-[10px]">Dry Run</span>
          </button>

          <button
            onClick={() => dispatch({ type: 'SET_ASSISTANT_OPEN', open: !cs.assistantOpen })}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-md border transition-colors ${cs.assistantOpen ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400' : 'bg-card border-primary/10 hover:bg-secondary/60 text-muted-foreground'}`}
            title="Canvas Assistant"
          >
            <Sparkles className="w-3.5 h-3.5" /><span className="text-[10px]">Assistant</span>
          </button>

          <SystemEventsToolbar onCanvasEventTypes={onCanvasEventTypes} onStartPointerDrag={variantB.startDrag} />
        </div>

        {/* Banner — only for click-to-place, not during pointer drag */}
        {showBanner && (
          <div className="absolute top-12 left-2 z-30 flex items-center gap-2 px-3 py-2 bg-card border border-amber-500/40 rounded-lg shadow-lg">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[11px] text-foreground font-medium">
              {showConnectBanner ? 'Click a persona node to complete connection' : `Click on canvas to place "${getPendingLabel()}"`}
            </span>
            <button onClick={() => { clearPendingItem(); cancelConnect(); forceRender(n => n + 1); }} className="p-0.5 rounded hover:bg-secondary/60 ml-1">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        )}

        <EventCanvasAssistant open={cs.assistantOpen} onClose={() => dispatch({ type: 'SET_ASSISTANT_OPEN', open: false })} onApply={() => {}} />

        <ReactFlow
          nodes={allNodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onEdgesDelete={onEdgesDelete}
          isValidConnection={isValidConnection}
          onNodeContextMenu={onNodeContextMenu} onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick} onPaneClick={onPaneClick}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'eventEdge' }}
          snapToGrid snapGrid={[GRID_SIZE, GRID_SIZE]}
          fitView fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={proOptions} className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} className="opacity-30" />
          <Controls showInteractive={false} position="bottom-right" className="!bg-card/80 !border-primary/10 !shadow-sm" />
        </ReactFlow>

        {cs.dryRunState && <EventDryRunBar dryRunState={cs.dryRunState} availableEventTypes={dryRun.availableEventTypes} onStart={dryRun.start} onStep={dryRun.step} onStop={dryRun.stop} />}

        {variantB.ghost && (
          <div className="fixed z-[100] pointer-events-none px-3 py-1.5 rounded-lg bg-card border border-primary/30 text-xs text-foreground shadow-xl" style={{ left: variantB.ghost.x + 14, top: variantB.ghost.y + 14 }}>
            {variantB.ghost.label}
          </div>
        )}

        {cs.edgeTooltip && (
          <EdgeTooltip x={cs.edgeTooltip.x} y={cs.edgeTooltip.y}
            currentType={(cs.edgeTooltip.edge.data as EventEdgeData)?.conditionType ?? 'always'}
            eventType={(cs.edgeTooltip.edge.data as EventEdgeData)?.eventType ?? ''}
            onChangeType={handleEdgeTypeChange} onDelete={handleEdgeDelete}
            onClose={() => dispatch({ type: 'SET_EDGE_TOOLTIP', tooltip: null })}
          />
        )}

        {contextMenu && (
          <div className="fixed z-[100] min-w-[190px] rounded-lg bg-card border border-primary/20 shadow-2xl py-1" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <div className="px-3 py-1.5 border-b border-primary/10"><span className="text-[10px] text-muted-foreground truncate block max-w-[170px]">{contextMenu.nodeLabel}</span></div>
            {contextMenu.eventType && <button onClick={handleTestFire} disabled={testFiring} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50">{testFiring ? <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}{testFiring ? 'Firing...' : 'Fire Test Event'}</button>}
            {contextMenu.nodeType === NODE_TYPE_EVENT_SOURCE && <button onClick={handleConnectFromMenu} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-secondary/60 transition-colors"><Link2 className="w-3.5 h-3.5 text-cyan-400" />Connect to persona...</button>}
            <button onClick={handleRemove} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5" />Remove from canvas</button>
          </div>
        )}

        {nodes.length === 0 && !cs.assistantOpen && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="text-center max-w-sm px-6 py-4 rounded-xl bg-card/80 border border-primary/10">
              <p className="text-sm text-foreground/70 mb-1">Click or drag items from the sidebar onto the canvas</p>
              <p className="text-xs text-muted-foreground mt-1">Right-click event source → "Connect to persona" to wire them</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
