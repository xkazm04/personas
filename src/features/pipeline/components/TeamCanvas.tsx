import { useCallback, useEffect, useMemo } from 'react';
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import {
  useDerivedCanvasState,
  useCanvasReducer,
  TeamToolbar,
} from '@/features/pipeline/sub_canvas';
import type { StickyNoteCategory } from '@/features/pipeline/sub_canvas';
import TeamList from './TeamList';
import CanvasFlowLayer from './canvas/CanvasFlowLayer';
import CanvasOverlays from './canvas/CanvasOverlays';
import { useCanvasHandlers, snapToGrid } from './canvas/useCanvasHandlers';
import { useCanvasPipelineActions } from './canvas/useCanvasPipelineActions';
import { useCanvasDragDrop } from './canvas/useCanvasDragDrop';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';

export default function TeamCanvas() {
  const selectedTeamId = usePersonaStore((s) => s.selectedTeamId);
  const teamMembers = usePersonaStore((s) => s.teamMembers) as PersonaTeamMember[];
  const teamConnections = usePersonaStore((s) => s.teamConnections) as PersonaTeamConnection[];
  const personas = usePersonaStore((s) => s.personas);

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

  // ── Derived canvas state (nodes + edges from source data) ──────────
  const derived = useDerivedCanvasState({
    selectedTeamId, teamMembers, teamConnections, personas,
    pipelineNodeStatuses: cs.pipelineNodeStatuses,
    analytics: cs.analytics,
    dismissedSuggestionIds: cs.dismissedSuggestionIds,
    dryRunState: cs.dryRunState,
    snapToGrid,
  });

  // ── Build sticky note nodes ────────────────────────────────────────
  const handleUpdateNote = useCallback((id: string, text: string, category: StickyNoteCategory) => {
    dispatch({ type: 'UPDATE_STICKY_NOTE', id, text, category });
  }, [dispatch]);

  const handleDeleteNote = useCallback((id: string) => {
    dispatch({ type: 'DELETE_STICKY_NOTE', id });
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, [dispatch, setNodes]);

  const stickyNodes = useMemo<Node[]>(() =>
    cs.stickyNotes.map((n) => ({
      id: n.id, type: 'stickyNote' as const,
      position: { x: n.x, y: n.y },
      data: { text: n.text, category: n.category, onUpdate: handleUpdateNote, onDelete: handleDeleteNote },
      dragHandle: '.cursor-grab',
    })),
  [cs.stickyNotes, handleUpdateNote, handleDeleteNote]);

  // ── Sync derived + sticky nodes into React Flow ────────────────────
  useEffect(() => {
    setNodes((prev) => {
      const posMap = new Map(prev.map((n) => [n.id, n.position]));
      const personaNodes = derived.nodes.map((n) => ({ ...n, position: posMap.get(n.id) ?? n.position }));
      const noteNodes = stickyNodes.map((n) => ({ ...n, position: posMap.get(n.id) ?? n.position }));
      return [...personaNodes, ...noteNodes];
    });
    setEdges(derived.edges);
  }, [derived, stickyNodes, setNodes, setEdges]);

  const onPaneClick = useCallback(() => { setContextMenu(null); setEdgeTooltip(null); }, [setContextMenu, setEdgeTooltip]);

  if (!selectedTeamId) {
    return <TeamList />;
  }

  return (
    <ContentBox minWidth={0}>
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
        className="flex-1 relative"
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
