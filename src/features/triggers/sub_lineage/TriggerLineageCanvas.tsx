import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutGrid, X, AlertOctagon, RefreshCw, ListFilter } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { listAllTriggers } from '@/api/pipeline/triggers';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

import { LineagePersonaNode } from './nodes/LineagePersonaNode';
import { LineageTriggerNode } from './nodes/LineageTriggerNode';
import { LineageEventNode } from './nodes/LineageEventNode';
import {
  deriveLineageGraph, computeBlastRadius,
  personaNodeId, triggerNodeId,
  type LineageGraph,
} from './libs/deriveLineageGraph';
import { computeLineageLayout } from './libs/computeLineageLayout';
import { silentCatch } from '@/lib/silentCatch';


const nodeTypes = {
  lineagePersona: LineagePersonaNode,
  lineageTrigger: LineageTriggerNode,
  lineageEvent: LineageEventNode,
};
const proOptions = { hideAttribution: true };

type FilterMode = 'all' | 'orphans' | 'cycles';

export function TriggerLineageCanvas() {
  return (
    <ReactFlowProvider>
      <TriggerLineageInner />
    </ReactFlowProvider>
  );
}

function TriggerLineageInner() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore(s => s.personas);
  const reactFlowInstance = useReactFlow();

  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  useEffect(() => {
    let stale = false;
    listAllTriggers()
      .then(rows => { if (!stale) setAllTriggers(rows); })
      .catch(() => { /* non-critical */ });
    return () => { stale = true; };
  }, []);

  const graph: LineageGraph = useMemo(
    () => deriveLineageGraph(personas, allTriggers),
    [personas, allTriggers],
  );

  const blastRadius = useMemo(() => {
    if (!selectedPersonaId) return null;
    return computeBlastRadius(selectedPersonaId, allTriggers);
  }, [selectedPersonaId, allTriggers]);

  // Compute trigger counts per persona for node sublabel
  const triggerCountByPersona = useMemo(() => {
    const map = new Map<string, number>();
    for (const tr of allTriggers) {
      map.set(tr.persona_id, (map.get(tr.persona_id) ?? 0) + 1);
    }
    return map;
  }, [allTriggers]);

  const downstreamCountByPersona = useMemo(() => {
    const map = new Map<string, number>();
    for (const tr of allTriggers) {
      if (tr.trigger_type !== 'chain' || !tr.config) continue;
      try {
        const cfg = JSON.parse(tr.config) as { source_persona_id?: string };
        if (!cfg.source_persona_id) continue;
        map.set(cfg.source_persona_id, (map.get(cfg.source_persona_id) ?? 0) + 1);
      } catch (err) { silentCatch("features/triggers/sub_lineage/TriggerLineageCanvas:catch1")(err); }
    }
    return map;
  }, [allTriggers]);

  const layout = useMemo(() => computeLineageLayout(graph), [graph]);

  const handlePersonaClick = useCallback((personaId: string) => {
    setSelectedPersonaId(prev => prev === personaId ? null : personaId);
  }, []);

  // Decorate nodes with live highlight/dim/blast/cycle state
  const decoratedNodes: Node[] = useMemo(() => {
    return layout.nodes.map(n => {
      const graphNode = graph.nodes.find(g => g.id === n.id);
      if (!graphNode) return n;

      let dimmed = false;
      if (filterMode === 'orphans') {
        const isOrphanRelated = graphNode.kind === 'trigger' && graphNode.isOrphan;
        const ownsOrphan = graphNode.kind === 'persona' &&
          allTriggers.some(tr => tr.persona_id === graphNode.persona.id && graph.orphanTriggerIds.has(tr.id));
        if (!isOrphanRelated && !ownsOrphan) dimmed = true;
      } else if (filterMode === 'cycles') {
        const inCycle = (graphNode.kind === 'trigger' && graph.cycleTriggerIds.has(graphNode.trigger.id))
          || (graphNode.kind === 'persona' && graph.cyclePersonaIds.has(graphNode.persona.id));
        if (!inCycle) dimmed = true;
      }

      if (blastRadius) {
        const isHighlighted = (graphNode.kind === 'persona' && blastRadius.personaIds.has(graphNode.persona.id))
          || (graphNode.kind === 'trigger' && blastRadius.triggerIds.has(graphNode.trigger.id));
        if (!isHighlighted) dimmed = true;
      }

      if (graphNode.kind === 'persona') {
        return {
          ...n,
          data: {
            persona: graphNode.persona,
            inCycle: graph.cyclePersonaIds.has(graphNode.persona.id),
            inBlastRadius: blastRadius?.personaIds.has(graphNode.persona.id) ?? false,
            blastSeed: selectedPersonaId === graphNode.persona.id,
            dimmed,
            triggerCount: triggerCountByPersona.get(graphNode.persona.id) ?? 0,
            downstreamCount: downstreamCountByPersona.get(graphNode.persona.id) ?? 0,
            onClick: () => handlePersonaClick(graphNode.persona.id),
          },
        };
      }
      if (graphNode.kind === 'trigger') {
        return {
          ...n,
          data: {
            trigger: graphNode.trigger,
            eventType: graphNode.eventType,
            isOrphan: graphNode.isOrphan,
            inCycle: graphNode.inCycle,
            inBlastRadius: blastRadius?.triggerIds.has(graphNode.trigger.id) ?? false,
            dimmed,
          },
        };
      }
      // event
      return { ...n, data: { eventType: graphNode.eventType, dimmed } };
    });
  }, [layout.nodes, graph, blastRadius, filterMode, selectedPersonaId, allTriggers, triggerCountByPersona, downstreamCountByPersona, handlePersonaClick]);

  const decoratedEdges: Edge[] = useMemo(() => {
    return layout.edges.map(e => {
      const data = e.data as { kind?: string; inCycle?: boolean } | undefined;
      const inCycle = data?.inCycle ?? false;
      let stroke = '#6366f1'; // chain default
      if (data?.kind === 'owns') stroke = '#10b981';
      if (data?.kind === 'listen') stroke = '#06b6d4';
      if (inCycle) stroke = '#ef4444';

      let opacity = 1;
      if (blastRadius) {
        const inBlast = blastRadius.triggerIds.has(stripPrefix(e.source, 'trigger:'))
          || blastRadius.triggerIds.has(stripPrefix(e.target, 'trigger:'))
          || blastRadius.personaIds.has(stripPrefix(e.source, 'persona:'))
          || blastRadius.personaIds.has(stripPrefix(e.target, 'persona:'));
        if (!inBlast) opacity = 0.15;
      } else if (filterMode === 'cycles' && !inCycle) {
        opacity = 0.15;
      } else if (filterMode === 'orphans') {
        // Dim non-orphan edges
        const triggerId = stripPrefix(e.source, 'trigger:') || stripPrefix(e.target, 'trigger:');
        const isOrphanEdge = triggerId && graph.orphanTriggerIds.has(triggerId);
        if (!isOrphanEdge) opacity = 0.15;
      }

      return {
        ...e,
        style: { stroke, strokeWidth: inCycle ? 2.5 : 1.5, opacity },
      };
    });
  }, [layout.edges, blastRadius, filterMode, graph.orphanTriggerIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(decoratedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(decoratedEdges);

  // Keep ReactFlow state in sync with derived state.
  useEffect(() => { setNodes(decoratedNodes); }, [decoratedNodes, setNodes]);
  useEffect(() => { setEdges(decoratedEdges); }, [decoratedEdges, setEdges]);

  const handleFit = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
  }, [reactFlowInstance]);

  const orphanCount = graph.orphanTriggerIds.size;
  const cycleCount = graph.cycleTriggerIds.size;
  const personaCount = graph.nodes.filter(n => n.kind === 'persona').length;
  const triggerCount = graph.nodes.filter(n => n.kind === 'trigger').length;
  const isEmpty = allTriggers.length === 0;

  return (
    <div className="flex-1 flex min-h-0 relative">
      <div className="flex-1 relative">
        {/* Toolbar */}
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1 flex-wrap">
          <button
            onClick={handleFit}
            className="flex items-center gap-1 px-2 py-1.5 rounded-input bg-card border border-primary/10 hover:bg-secondary/60 transition-colors text-foreground"
            title={t.triggers.lineage.fit_view}
          >
            <LayoutGrid className="w-3.5 h-3.5" /><span className="text-[10px]">{t.triggers.lineage.fit_view}</span>
          </button>

          <div className="flex items-center rounded-input bg-card border border-primary/10 overflow-hidden">
            <button
              onClick={() => setFilterMode('all')}
              className={`flex items-center gap-1 px-2 py-1.5 text-[10px] transition-colors ${
                filterMode === 'all' ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary/60'
              }`}
            >
              <ListFilter className="w-3 h-3" />{t.triggers.lineage.filter_show_all}
            </button>
            <button
              onClick={() => setFilterMode('orphans')}
              className={`flex items-center gap-1 px-2 py-1.5 text-[10px] transition-colors border-l border-primary/10 ${
                filterMode === 'orphans' ? 'bg-amber-500/10 text-amber-400' : 'text-foreground hover:bg-secondary/60'
              }`}
            >
              <AlertOctagon className="w-3 h-3" />{t.triggers.lineage.filter_show_orphans} ({orphanCount})
            </button>
            <button
              onClick={() => setFilterMode('cycles')}
              className={`flex items-center gap-1 px-2 py-1.5 text-[10px] transition-colors border-l border-primary/10 ${
                filterMode === 'cycles' ? 'bg-red-500/10 text-red-400' : 'text-foreground hover:bg-secondary/60'
              }`}
            >
              <RefreshCw className="w-3 h-3" />{t.triggers.lineage.filter_show_cycles} ({cycleCount})
            </button>
          </div>

          {selectedPersonaId && (
            <button
              onClick={() => setSelectedPersonaId(null)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-input bg-amber-500/10 border border-amber-400/40 text-amber-400 hover:bg-amber-500/15 transition-colors"
              title={t.triggers.lineage.clear_highlight}
            >
              <X className="w-3 h-3" /><span className="text-[10px]">{t.triggers.lineage.clear_highlight}</span>
            </button>
          )}
        </div>

        {/* Stats bar */}
        {!isEmpty && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-3 px-3 py-1.5 rounded-card bg-card/80 border border-primary/10">
            <span className="text-[10px] text-foreground">
              <span className="text-emerald-400 font-medium">{personaCount}</span> {t.triggers.lineage.personas_label}
            </span>
            <span className="text-[10px] text-foreground">
              <span className="text-amber-400 font-medium">{triggerCount}</span> {t.triggers.lineage.triggers_label}
            </span>
            <span className="text-[10px] text-foreground">
              <span className="text-indigo-400 font-medium">{graph.edges.length}</span> {t.triggers.lineage.connections_label}
            </span>
            {orphanCount > 0 && (
              <span className="text-[10px] text-foreground">
                <span className="text-foreground font-medium">{orphanCount}</span> {t.triggers.lineage.orphans_label}
              </span>
            )}
            {cycleCount > 0 && (
              <span className="text-[10px] text-foreground">
                <span className="text-red-400 font-medium">{cycleCount}</span> {t.triggers.lineage.cycles_label}
              </span>
            )}
          </div>
        )}

        {/* Blast-radius hint */}
        {!selectedPersonaId && !isEmpty && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-card bg-card/80 border border-primary/10 pointer-events-none">
            <span className="text-[10px] text-foreground">{t.triggers.lineage.select_persona_for_blast}</span>
          </div>
        )}

        {/* Blast-radius summary */}
        {selectedPersonaId && blastRadius && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-card bg-amber-500/10 border border-amber-400/40">
            <span className="text-[10px] text-foreground">
              {tx(blastRadius.triggerIds.size === 1 ? t.triggers.lineage.trigger_count_one : t.triggers.lineage.trigger_count_other,
                { count: blastRadius.triggerIds.size })}
              {' · '}
              {tx(blastRadius.personaIds.size === 1 ? t.triggers.lineage.downstream_count_one : t.triggers.lineage.downstream_count_other,
                { count: blastRadius.personaIds.size })}
            </span>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={proOptions}
          minZoom={0.2}
          maxZoom={1.5}
          className="bg-background"
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-30" />
          <Controls showInteractive={false} position="bottom-right" className="!bg-card/80 !border-primary/10 !shadow-elevation-1" />
          <MiniMap
            nodeStrokeWidth={2}
            nodeColor={(n) => {
              if (n.type === 'lineagePersona') return '#10b981';
              if (n.type === 'lineageTrigger') return '#f59e0b';
              if (n.type === 'lineageEvent') return '#06b6d4';
              return '#6b7280';
            }}
            className="!bg-card/60 !border-primary/10"
            position="bottom-left"
          />
        </ReactFlow>

        {/* Empty state */}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="text-center max-w-md px-8 py-6 rounded-modal bg-card/80 border border-primary/10">
              <h3 className="typo-heading font-semibold text-foreground mb-2">{t.triggers.lineage.no_triggers_empty}</h3>
              <p className="typo-caption text-foreground">{t.triggers.lineage.no_triggers_empty_desc}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : '';
}

// Re-export node-id helpers for consumers who need to compute selection externally.
export { personaNodeId, triggerNodeId };
