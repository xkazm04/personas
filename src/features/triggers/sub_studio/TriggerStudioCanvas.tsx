import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type Connection, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  PanelLeft, PanelLeftClose, Trash2, LayoutGrid, Save,
  Download, Upload,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { createLogger } from '@/lib/log';
import type { Persona } from '@/lib/bindings/Persona';

const logger = createLogger('trigger-studio');

import { TriggerSourceNode } from './nodes/TriggerSourceNode';
import { PersonaStepNode } from './nodes/PersonaStepNode';
import { ConditionGateNode } from './nodes/ConditionGateNode';
import { ChainEdge } from './edges/ChainEdge';
import { TriggerStudioPalette } from './palettes/TriggerStudioPalette';
import { useTriggerStudioState } from './hooks/useTriggerStudioState';
import {
  NODE_TYPE_TRIGGER_SOURCE,
  NODE_TYPE_PERSONA_STEP,
  NODE_TYPE_CONDITION_GATE,
  EDGE_TYPE_CHAIN,
  GRID_SIZE,
  STUDIO_LAYOUT_KEY,
  STUDIO_LAYOUT_VERSION,
  type TriggerBlockTemplate,
  type TriggerSourceNodeData,
  type PersonaStepNodeData,
  type ConditionGateNodeData,
  type ConditionBranch,
  type ChainEdgeData,
} from './libs/triggerStudioConstants';

const nodeTypes = {
  [NODE_TYPE_TRIGGER_SOURCE]: TriggerSourceNode,
  [NODE_TYPE_PERSONA_STEP]: PersonaStepNode,
  [NODE_TYPE_CONDITION_GATE]: ConditionGateNode,
};
const edgeTypes = { [EDGE_TYPE_CHAIN]: ChainEdge };
const proOptions = { hideAttribution: true };

// ---------------------------------------------------------------------------
// Layout persistence
// ---------------------------------------------------------------------------

interface SavedStudioLayout {
  version: number;
  nodes: Array<{ id: string; x: number; y: number; type: string; data: unknown }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }>;
}

function saveStudioLayout(nodes: Node[], edges: Edge[]) {
  const layout: SavedStudioLayout = {
    version: STUDIO_LAYOUT_VERSION,
    nodes: nodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y, type: n.type ?? '', data: n.data })),
    edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data })),
  };
  try { localStorage.setItem(STUDIO_LAYOUT_KEY, JSON.stringify(layout)); } catch { /* localStorage may be full */ }
}

function loadStudioLayout(): SavedStudioLayout | null {
  try {
    const raw = localStorage.getItem(STUDIO_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedStudioLayout;
    if (parsed.version !== STUDIO_LAYOUT_VERSION) return null;
    return parsed;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Auto-layout
// ---------------------------------------------------------------------------

function computeStudioAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const triggers = nodes.filter(n => n.type === NODE_TYPE_TRIGGER_SOURCE);
  const personas = nodes.filter(n => n.type === NODE_TYPE_PERSONA_STEP);
  const conditions = nodes.filter(n => n.type === NODE_TYPE_CONDITION_GATE);

  const COL_GAP = 280;
  const ROW_GAP = 120;
  const START_Y = 80;

  const updated = nodes.map(n => ({ ...n, position: { ...n.position } }));

  // Column 0: trigger sources
  triggers.forEach((n, i) => {
    const u = updated.find(u => u.id === n.id);
    if (u) { u.position = { x: 80, y: START_Y + i * ROW_GAP }; }
  });

  // Column 1: personas that receive from triggers (have incoming edges from trigger sources)
  const directPersonas = personas.filter(p =>
    edges.some(e => e.target === p.id && triggers.some(t => t.id === e.source))
  );
  const otherPersonas = personas.filter(p => !directPersonas.includes(p));

  directPersonas.forEach((n, i) => {
    const u = updated.find(u => u.id === n.id);
    if (u) { u.position = { x: 80 + COL_GAP, y: START_Y + i * ROW_GAP }; }
  });

  // Column 2: condition gates
  conditions.forEach((n, i) => {
    const u = updated.find(u => u.id === n.id);
    if (u) { u.position = { x: 80 + COL_GAP * 2, y: START_Y + i * ROW_GAP }; }
  });

  // Column 3: downstream personas
  otherPersonas.forEach((n, i) => {
    const u = updated.find(u => u.id === n.id);
    if (u) { u.position = { x: 80 + COL_GAP * 3, y: START_Y + i * ROW_GAP }; }
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Export chain definition as JSON
// ---------------------------------------------------------------------------

interface ExportedChain {
  name: string;
  nodes: Array<{ id: string; type: string; data: unknown }>;
  edges: Array<{ source: string; target: string; label?: string; conditionBranch?: string }>;
}

function exportChainAsJson(nodes: Node[], edges: Edge[]): string {
  const chain: ExportedChain = {
    name: 'Trigger Chain',
    nodes: nodes.map(n => ({ id: n.id, type: n.type ?? '', data: n.data })),
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      label: (e.data as ChainEdgeData)?.label,
      conditionBranch: (e.data as ChainEdgeData)?.conditionBranch,
    })),
  };
  return JSON.stringify(chain, null, 2);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TriggerStudioCanvas() {
  return <ReactFlowProvider><TriggerStudioInner /></ReactFlowProvider>;
}

function TriggerStudioInner() {
  const { t } = useTranslation();
  const personas = useAgentStore(s => s.personas);
  const reactFlowInstance = useReactFlow();
  const [cs, dispatch] = useTriggerStudioState();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save layout
  useEffect(() => {
    if (nodes.length === 0 && edges.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveStudioLayout(nodes, edges), 800);
  }, [nodes, edges]);

  // Load layout on mount
  useEffect(() => {
    const saved = loadStudioLayout();
    if (!saved) return;
    const restoredNodes: Node[] = saved.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      data: n.data as Record<string, unknown>,
    }));
    const restoredEdges: Edge[] = saved.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: EDGE_TYPE_CHAIN,
      data: e.data as Record<string, unknown>,
    }));
    setNodes(restoredNodes);
    setEdges(restoredEdges);
  }, [setNodes, setEdges]);

  // Generate unique node id
  const nextId = useCallback((prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, []);

  // Get viewport center for placing new nodes
  const getPlacementPosition = useCallback(() => {
    const viewport = reactFlowInstance.getViewport();
    const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!bounds) return { x: 300, y: 200 };
    const centerX = (-viewport.x + bounds.width / 2) / viewport.zoom;
    const centerY = (-viewport.y + bounds.height / 2) / viewport.zoom;
    // Add slight randomness to avoid stacking
    return {
      x: Math.round((centerX + (Math.random() - 0.5) * 100) / GRID_SIZE) * GRID_SIZE,
      y: Math.round((centerY + (Math.random() - 0.5) * 100) / GRID_SIZE) * GRID_SIZE,
    };
  }, [reactFlowInstance]);

  // Add nodes from palette
  const handleAddTriggerSource = useCallback((template: TriggerBlockTemplate) => {
    const pos = getPlacementPosition();
    const id = nextId('trigger');
    setNodes(prev => [...prev, {
      id,
      type: NODE_TYPE_TRIGGER_SOURCE,
      position: pos,
      data: {
        triggerType: template.triggerType,
        label: template.label,
        iconName: template.icon.displayName ?? 'Zap',
        color: template.color,
      } satisfies TriggerSourceNodeData,
    }]);
    dispatch({ type: 'MARK_DIRTY' });
  }, [setNodes, nextId, getPlacementPosition, dispatch]);

  const handleAddPersonaStep = useCallback((persona: Persona) => {
    const pos = getPlacementPosition();
    const id = nextId('persona');
    setNodes(prev => [...prev, {
      id,
      type: NODE_TYPE_PERSONA_STEP,
      position: pos,
      data: {
        personaId: persona.id,
        name: persona.name,
        icon: persona.icon ?? '',
        color: persona.color ?? 'text-emerald-400',
        enabled: persona.enabled,
      } satisfies PersonaStepNodeData,
    }]);
    dispatch({ type: 'MARK_DIRTY' });
  }, [setNodes, nextId, getPlacementPosition, dispatch]);

  const handleAddConditionGate = useCallback((label: string, branches: ConditionBranch[]) => {
    const pos = getPlacementPosition();
    const id = nextId('cond');
    setNodes(prev => [...prev, {
      id,
      type: NODE_TYPE_CONDITION_GATE,
      position: pos,
      data: {
        conditionLabel: label,
        branches,
      } satisfies ConditionGateNodeData,
    }]);
    dispatch({ type: 'MARK_DIRTY' });
  }, [setNodes, nextId, getPlacementPosition, dispatch]);

  // Connection validation
  const isValidConnection = useCallback((c: Edge | Connection) => {
    const source = nodes.find(n => n.id === c.source);
    const target = nodes.find(n => n.id === c.target);
    if (!source || !target) return false;

    // Trigger source can only connect to persona step or condition gate
    if (source.type === NODE_TYPE_TRIGGER_SOURCE) {
      return target.type === NODE_TYPE_PERSONA_STEP || target.type === NODE_TYPE_CONDITION_GATE;
    }
    // Persona step can chain to persona step or condition gate
    if (source.type === NODE_TYPE_PERSONA_STEP) {
      return target.type === NODE_TYPE_PERSONA_STEP || target.type === NODE_TYPE_CONDITION_GATE;
    }
    // Condition gate branches can connect to persona step
    if (source.type === NODE_TYPE_CONDITION_GATE) {
      return target.type === NODE_TYPE_PERSONA_STEP;
    }
    return false;
  }, [nodes]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    const source = nodes.find(n => n.id === c.source);

    // Determine edge label
    let label: string | undefined;
    let conditionBranch: string | undefined;
    if (source?.type === NODE_TYPE_CONDITION_GATE && c.sourceHandle) {
      const branchId = c.sourceHandle.replace('branch-', '');
      const data = source.data as ConditionGateNodeData;
      const branch = data.branches?.find((b: ConditionBranch) => b.id === branchId);
      label = branch?.label;
      conditionBranch = branchId;
    }

    const edge: Edge = {
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: c.source,
      target: c.target,
      sourceHandle: c.sourceHandle,
      targetHandle: c.targetHandle,
      type: EDGE_TYPE_CHAIN,
      data: { label, conditionBranch } satisfies ChainEdgeData,
    };
    setEdges(prev => [...prev, edge]);
    dispatch({ type: 'MARK_DIRTY' });
  }, [nodes, setEdges, dispatch]);

  // Context menu
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const handleRemoveNode = useCallback(() => {
    if (!contextMenu) return;
    setNodes(prev => prev.filter(n => n.id !== contextMenu.nodeId));
    setEdges(prev => prev.filter(e => e.source !== contextMenu.nodeId && e.target !== contextMenu.nodeId));
    setContextMenu(null);
    dispatch({ type: 'MARK_DIRTY' });
  }, [contextMenu, setNodes, setEdges, dispatch]);

  const onPaneClick = useCallback(() => { setContextMenu(null); }, []);

  // Toolbar actions
  const handleAutoLayout = useCallback(() => {
    setNodes(computeStudioAutoLayout(nodes, edges));
  }, [nodes, edges, setNodes]);

  const handleClear = useCallback(() => {
    setNodes([]);
    setEdges([]);
    localStorage.removeItem(STUDIO_LAYOUT_KEY);
    dispatch({ type: 'MARK_CLEAN' });
  }, [setNodes, setEdges, dispatch]);

  const handleExport = useCallback(() => {
    const json = exportChainAsJson(nodes, edges);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trigger-chain.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const chain = JSON.parse(text) as ExportedChain;
        const importedNodes: Node[] = chain.nodes.map((n, i) => ({
          id: n.id,
          type: n.type,
          position: { x: 80 + (i % 4) * 280, y: 80 + Math.floor(i / 4) * 120 },
          data: n.data as Record<string, unknown>,
        }));
        const importedEdges: Edge[] = chain.edges.map((e, i) => ({
          id: `imported-${i}-${Date.now()}`,
          source: e.source,
          target: e.target,
          type: EDGE_TYPE_CHAIN,
          data: { label: e.label, conditionBranch: e.conditionBranch } satisfies ChainEdgeData,
        }));
        setNodes(importedNodes);
        setEdges(importedEdges);
        dispatch({ type: 'MARK_DIRTY' });
      } catch (err) {
        logger.error('Failed to import', { error: err instanceof Error ? err.message : String(err) });
      }
    };
    input.click();
  }, [setNodes, setEdges, dispatch]);

  // Node counts for empty state
  const isEmpty = nodes.length === 0;

  return (
    <div className="flex-1 flex min-h-0">
      {!cs.paletteCollapsed && (
        <div className="w-64 border-r border-primary/10 flex flex-col overflow-hidden bg-card/30 z-20 relative">
          <TriggerStudioPalette
            personas={personas}
            onAddTriggerSource={handleAddTriggerSource}
            onAddPersonaStep={handleAddPersonaStep}
            onAddConditionGate={handleAddConditionGate}
          />
        </div>
      )}

      <div className="flex-1 relative z-10">
        {/* Toolbar */}
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1 flex-wrap">
          <button
            onClick={() => dispatch({ type: 'TOGGLE_PALETTE' })}
            className="p-1.5 rounded-input bg-card border border-primary/10 hover:bg-secondary/60 transition-colors"
            title={cs.paletteCollapsed ? t.triggers.builder.show_sidebar : t.triggers.builder.hide_sidebar}
          >
            {cs.paletteCollapsed
              ? <PanelLeft className="w-3.5 h-3.5 text-foreground" />
              : <PanelLeftClose className="w-3.5 h-3.5 text-foreground" />
            }
          </button>

          <button
            onClick={handleAutoLayout}
            className="flex items-center gap-1 px-2 py-1.5 rounded-input bg-card border border-primary/10 hover:bg-secondary/60 transition-colors text-foreground"
            title={t.triggers.builder.auto_layout}
          >
            <LayoutGrid className="w-3.5 h-3.5" /><span className="text-[10px]">{t.triggers.builder.layout}</span>
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-2 py-1.5 rounded-input bg-card border border-primary/10 hover:bg-secondary/60 transition-colors text-foreground"
            title={t.triggers.studio.export_chain}
          >
            <Download className="w-3.5 h-3.5" /><span className="text-[10px]">{t.triggers.studio.export}</span>
          </button>

          <button
            onClick={handleImport}
            className="flex items-center gap-1 px-2 py-1.5 rounded-input bg-card border border-primary/10 hover:bg-secondary/60 transition-colors text-foreground"
            title={t.triggers.studio.import_chain}
          >
            <Upload className="w-3.5 h-3.5" /><span className="text-[10px]">{t.triggers.studio.import}</span>
          </button>

          <button
            onClick={handleClear}
            className="flex items-center gap-1 px-2 py-1.5 rounded-input bg-card border border-primary/10 hover:bg-red-500/10 transition-colors text-foreground hover:text-red-400"
            title={t.triggers.studio.clear_canvas}
          >
            <Trash2 className="w-3.5 h-3.5" /><span className="text-[10px]">{t.triggers.studio.clear}</span>
          </button>

          {cs.isDirty && (
            <span className="flex items-center gap-1 px-2 py-1 text-[9px] text-amber-400/70">
              <Save className="w-3 h-3" /> {t.triggers.studio.unsaved_changes}
            </span>
          )}
        </div>

        {/* Stats bar */}
        {!isEmpty && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-3 px-3 py-1.5 rounded-card bg-card/80 border border-primary/10">
            <span className="text-[10px] text-foreground">
              <span className="text-amber-400 font-medium">{nodes.filter(n => n.type === NODE_TYPE_TRIGGER_SOURCE).length}</span> triggers
            </span>
            <span className="text-[10px] text-foreground">
              <span className="text-emerald-400 font-medium">{nodes.filter(n => n.type === NODE_TYPE_PERSONA_STEP).length}</span> personas
            </span>
            <span className="text-[10px] text-foreground">
              <span className="text-violet-400 font-medium">{nodes.filter(n => n.type === NODE_TYPE_CONDITION_GATE).length}</span> conditions
            </span>
            <span className="text-[10px] text-foreground">
              <span className="text-indigo-400 font-medium">{edges.length}</span> connections
            </span>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: EDGE_TYPE_CHAIN }}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={proOptions}
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} className="opacity-30" />
          <Controls showInteractive={false} position="bottom-right" className="!bg-card/80 !border-primary/10 !shadow-elevation-1" />
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={(n) => {
              if (n.type === NODE_TYPE_TRIGGER_SOURCE) return '#f59e0b';
              if (n.type === NODE_TYPE_PERSONA_STEP) return '#10b981';
              if (n.type === NODE_TYPE_CONDITION_GATE) return '#8b5cf6';
              return '#6b7280';
            }}
            className="!bg-card/60 !border-primary/10"
            position="bottom-left"
          />
        </ReactFlow>

        {/* Context menu */}
        {contextMenu && (
          <div
            className="fixed z-[100] min-w-[160px] rounded-card bg-card border border-primary/20 shadow-elevation-4 py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={handleRemoveNode}
              className="flex items-center gap-2 w-full px-3 py-2 typo-caption text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.triggers.studio.remove_from_chain}
            </button>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="text-center max-w-md px-8 py-6 rounded-modal bg-card/80 border border-primary/10">
              <h3 className="typo-heading font-semibold text-foreground mb-2">{t.triggers.studio.studio_title}</h3>
              <p className="typo-caption text-foreground mb-3">
                {t.triggers.studio_empty_desc}
              </p>
              <div className="flex flex-col gap-1.5 text-[11px] text-foreground">
                <span>{t.triggers.studio_step1}</span>
                <span>{t.triggers.studio_step2}</span>
                <span>{t.triggers.studio_step3}</span>
                <span>{t.triggers.studio_step4}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
