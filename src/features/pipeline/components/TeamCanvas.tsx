import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Columns2, Workflow } from 'lucide-react';
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import {
  useDerivedCanvasState,
  useCanvasReducer,
  TeamToolbar,
} from '@/features/pipeline/sub_canvas';
import TeamList from './TeamList';
import CanvasFlowLayer from './canvas/CanvasFlowLayer';
import CanvasOverlays from './canvas/CanvasOverlays';
import { useCanvasHandlers, snapToGrid } from './canvas/useCanvasHandlers';
import { useCanvasPipelineActions } from './canvas/useCanvasPipelineActions';
import { useCanvasDragDrop } from './canvas/useCanvasDragDrop';
import { TeamStudioGridVariant } from './teamStudio/TeamStudioGridVariant';
import { TeamStudioSplitVariant } from './teamStudio/TeamStudioSplitVariant';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';

// /prototype scaffold — throwaway tab switcher to A/B the Team Studio
// directions against the baseline DAG canvas. Default 'canvas' so the
// live render is unchanged on load.
type StudioTab = 'canvas' | 'grid' | 'split';
const STUDIO_TABS: { id: StudioTab; label: string; icon: typeof Workflow }[] = [
  { id: 'canvas', label: 'Canvas (baseline)', icon: Workflow },
  { id: 'grid', label: 'Grid Studio', icon: LayoutGrid },
  { id: 'split', label: 'Split Studio', icon: Columns2 },
];

export default function TeamCanvas() {
  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const teamMembers = usePipelineStore((s) => s.teamMembers) as PersonaTeamMember[];
  const teamConnections = usePipelineStore((s) => s.teamConnections) as PersonaTeamConnection[];
  const personas = useAgentStore((s) => s.personas);

  const { state: cs, dispatch, setSaveStatus, setSelectedMember, setContextMenu, setEdgeTooltip, setGhostNode, setReactFlowInstance } = useCanvasReducer();
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const pipeline = useCanvasPipelineActions({ cs, dispatch });

  const dragDrop = useCanvasDragDrop({ cs, setGhostNode });

  const handlers = useCanvasHandlers({
    cs, dispatch, setSaveStatus, setSelectedMember, setContextMenu,
    setEdgeTooltip, nodes, setNodes, onNodesChangeBase,
    fetchAnalytics: pipeline.fetchAnalytics,
  });

  // -- Derived canvas state (nodes + edges from source data) ----------
  const derived = useDerivedCanvasState({
    selectedTeamId, teamMembers, teamConnections, personas,
    pipelineNodeStatuses: cs.pipelineNodeStatuses,
    analytics: cs.analytics,
    dismissedSuggestionIds: cs.dismissedSuggestionIds,
    dryRunState: cs.dryRunState,
    pipelineCycleNodeIds: cs.pipelineCycleNodeIds,
    snapToGrid,
  });

  // -- Build sticky note nodes ----------------------------------------
  const stickyNodes = useMemo<Node[]>(() =>
    cs.stickyNotes.map((n) => ({
      id: n.id, type: 'stickyNote' as const,
      position: { x: n.x, y: n.y },
      data: { text: n.text, category: n.category, onUpdate: handlers.handleUpdateNote, onDelete: handlers.handleDeleteNote },
      dragHandle: '.cursor-grab',
    })),
  [cs.stickyNotes, handlers.handleUpdateNote, handlers.handleDeleteNote]);

  // -- Sync derived + sticky nodes into React Flow --------------------
  // Preserves node references when the user-dragged position matches the
  // derived-computed position. Previously every PIPELINE_STATUS tick spread
  // each node into a fresh `{ ...n, position }` object even when nothing had
  // changed, defeating PersonaNode's React.memo and re-rendering the full
  // canvas on a team with 30-60 members several times per second.
  useEffect(() => {
    setNodes((prev) => {
      const posMap = new Map(prev.map((n) => [n.id, n.position]));
      const reconcile = <N extends Node>(n: N): N => {
        const savedPos = posMap.get(n.id);
        if (savedPos === undefined) return n;
        if (savedPos.x === n.position.x && savedPos.y === n.position.y) return n;
        return { ...n, position: savedPos };
      };
      const personaNodes = derived.nodes.map(reconcile);
      const noteNodes = stickyNodes.map(reconcile);
      return [...personaNodes, ...noteNodes];
    });
    setEdges(derived.edges);
  }, [derived, stickyNodes, setNodes, setEdges]);

  const onPaneClick = useCallback(() => { setContextMenu(null); setEdgeTooltip(null); }, [setContextMenu, setEdgeTooltip]);

  const [studioTab, setStudioTab] = useState<StudioTab>('canvas');

  if (!selectedTeamId) {
    return <TeamList />;
  }

  const teamName = handlers.selectedTeam?.name || 'Team';

  // /prototype tab strip — switch between baseline canvas and the two
  // Team Studio directions. Removed at consolidation.
  const tabStrip = (
    <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 border-b border-primary/10 bg-secondary/10">
      {STUDIO_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = studioTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStudioTab(tab.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption font-medium transition-colors ${
              active
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-foreground/60 border border-transparent hover:bg-secondary/30'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  if (studioTab === 'grid') {
    return (
      <ContentBox minWidth={0} data-testid="team-canvas">
        {tabStrip}
        <TeamStudioGridVariant
          teamId={selectedTeamId}
          teamName={teamName}
        />
      </ContentBox>
    );
  }

  if (studioTab === 'split') {
    return (
      <ContentBox minWidth={0} data-testid="team-canvas">
        {tabStrip}
        <TeamStudioSplitVariant
          teamId={selectedTeamId}
          teamName={teamName}
        />
      </ContentBox>
    );
  }

  return (
    <ContentBox minWidth={0} data-testid="team-canvas">
      {tabStrip}
      <div className="relative z-10">
        <TeamToolbar
          teamName={handlers.selectedTeam?.name || 'Team'}
          onBack={handlers.handleBack}
          onAutoLayout={handlers.handleAutoLayout}
          onSave={handlers.handleSave}
          onAddMember={handlers.handleAddMember}
          onAddNote={handlers.handleAddNote}
          saveStatus={cs.saveStatus}
        />
      </div>

      <div
        className="flex-1 relative drop-zone-illuminated rounded-card"
        data-dragging={dragDrop.isDragOver ? 'true' : undefined}
        onDrop={dragDrop.onCanvasDrop}
        onDragOver={dragDrop.onCanvasDragOver}
        onDragLeave={dragDrop.onCanvasDragLeave}
      >
        <CanvasFlowLayer
          nodes={nodes}
          edges={edges}
          ghostNode={cs.ghostNode}
          alignmentLines={cs.alignmentLines}
          isDraggingNode={cs.isDraggingNode}
          onInit={setReactFlowInstance}
          onNodesChange={handlers.onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handlers.onConnect}
          isValidConnection={handlers.isValidConnection}
          onNodeClick={handlers.onNodeClick}
          onEdgeClick={handlers.onEdgeClick}
          onNodeDrag={handlers.onNodeDrag}
          onNodeDragStop={handlers.onNodeDragStop}
          onNodeContextMenu={handlers.onNodeContextMenu}
          onPaneClick={onPaneClick}
        />

        <CanvasOverlays
          cs={cs}
          dispatch={dispatch}
          selectedTeamId={selectedTeamId}
          teamMembers={handlers.teamMembers}
          teamConnections={handlers.teamConnections}
          agentNames={handlers.agentNames}
          agentRoles={handlers.agentRoles}
          fetchAnalytics={pipeline.fetchAnalytics}
          handleAcceptSuggestion={pipeline.handleAcceptSuggestion}
          handleDismissSuggestion={pipeline.handleDismissSuggestion}
          handleAssistantSuggest={pipeline.handleAssistantSuggest}
          handleAssistantApply={pipeline.handleAssistantApply}
          handleExecuteTeam={pipeline.handleExecuteTeam}
          handleStartDryRun={pipeline.handleStartDryRun}
          handleDryRunStateChange={pipeline.handleDryRunStateChange}
          handleCloseDryRun={pipeline.handleCloseDryRun}
          handleRoleChange={handlers.handleRoleChange}
          handleRemoveMember={handlers.handleRemoveMember}
          handleDeleteEdge={handlers.handleDeleteEdge}
          handleChangeConnectionType={handlers.handleChangeConnectionType}
          setSelectedMember={setSelectedMember}
          setContextMenu={setContextMenu}
          setEdgeTooltip={setEdgeTooltip}
        />
      </div>
    </ContentBox>
  );
}
