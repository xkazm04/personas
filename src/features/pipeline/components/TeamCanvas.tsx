import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AnimatePresence } from 'framer-motion';
import { Users } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox } from '@/features/shared/components/ContentLayout';
import * as api from '@/api/tauriApi';
import {
  useDerivedCanvasState,
  useCanvasReducer,
  PersonaNode,
  StickyNoteNode,
  ConnectionEdge,
  GhostEdge,
  TeamToolbar,
  NodeContextMenu,
  EdgeDeleteTooltip,
  PipelineControls,
  OptimizerPanel,
  CanvasAssistant,
  DryRunDebugger,
  AlignmentGuides,
  computeAlignments,
  ConnectionLegend,
  useCanvasDragRef,
  buildTeamGraph,
} from '@/features/pipeline/sub_canvas';
import type { PipelineNodeStatus } from '@/features/pipeline/sub_canvas';
import type { StickyNoteCategory } from '@/features/pipeline/sub_canvas';
import type { DryRunState } from '@/features/pipeline/sub_canvas';
import TeamList from '@/features/pipeline/components/TeamList';
import TeamConfigPanel from '@/features/pipeline/components/TeamConfigPanel';
import TeamMemoryPanel from '@/features/pipeline/sub_teamMemory/TeamMemoryPanel';
import TeamMemoryBadge from '@/features/pipeline/sub_teamMemory/TeamMemoryBadge';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import type { TopologySuggestion } from '@/lib/bindings/TopologySuggestion';

const nodeTypes = { persona: PersonaNode, stickyNote: StickyNoteNode };
const edgeTypes = { connection: ConnectionEdge, ghost: GhostEdge };

const GRID_SIZE = 24;
function snapToGrid(v: number) {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

export default function TeamCanvas() {
  const canvasDragRef = useCanvasDragRef();

  // ── Store selectors ──────────────────────────────────────────────
  const selectedTeamId = usePersonaStore((s) => s.selectedTeamId);
  const selectTeam = usePersonaStore((s) => s.selectTeam);
  const teams = usePersonaStore((s) => s.teams);
  const teamMembers = usePersonaStore((s) => s.teamMembers) as PersonaTeamMember[];
  const teamConnections = usePersonaStore((s) => s.teamConnections) as PersonaTeamConnection[];
  const addTeamMember = usePersonaStore((s) => s.addTeamMember);
  const removeTeamMember = usePersonaStore((s) => s.removeTeamMember);
  const createTeamConnection = usePersonaStore((s) => s.createTeamConnection);
  const deleteTeamConnection = usePersonaStore((s) => s.deleteTeamConnection);
  const updateTeamConnection = usePersonaStore((s) => s.updateTeamConnection);
  const personas = usePersonaStore((s) => s.personas);
  const teamMemories = usePersonaStore((s) => s.teamMemories);
  const teamMemoriesTotal = usePersonaStore((s) => s.teamMemoriesTotal);
  const teamMemoryStats = usePersonaStore((s) => s.teamMemoryStats);
  const memoryFilterCategory = usePersonaStore((s) => s.memoryFilterCategory);
  const memoryFilterSearch = usePersonaStore((s) => s.memoryFilterSearch);
  const fetchTeamMemories = usePersonaStore((s) => s.fetchTeamMemories);
  const loadMoreTeamMemories = usePersonaStore((s) => s.loadMoreTeamMemories);
  const createTeamMemory = usePersonaStore((s) => s.createTeamMemory);
  const deleteTeamMemory = usePersonaStore((s) => s.deleteTeamMemory);
  const updateTeamMemoryImportance = usePersonaStore((s) => s.updateTeamMemoryImportance);
  const updateTeamMemory = usePersonaStore((s) => s.updateTeamMemory);

  // ── Canvas reducer (replaces ~18 useState hooks) ─────────────────
  const { state: cs, dispatch, setSaveStatus, setSelectedMember, setContextMenu, setEdgeTooltip, setGhostNode, setReactFlowInstance } = useCanvasReducer();

  // ── React Flow node/edge state ──────────────────────────────────
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const lastGhostPos = useRef({ x: 0, y: 0 });

  const selectedTeam = useMemo(
    () => teams.find((t: PersonaTeam) => t.id === selectedTeamId),
    [teams, selectedTeamId],
  );

  // ── Derived lookups ─────────────────────────────────────────────
  const agentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of teamMembers) {
      const persona = personas.find((p) => p.id === m.persona_id);
      map[m.id] = persona?.name || 'Agent';
    }
    return map;
  }, [teamMembers, personas]);

  const agentRoles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of teamMembers) {
      map[m.id] = m.role || 'worker';
    }
    return map;
  }, [teamMembers]);

  // ── Analytics ──────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async () => {
    if (!selectedTeamId) return;
    dispatch({ type: 'SET_ANALYTICS_LOADING', loading: true });
    try {
      const data = await api.getPipelineAnalytics(selectedTeamId);
      dispatch({ type: 'SET_ANALYTICS', analytics: data });
    } catch (err) {
      console.error('Failed to fetch pipeline analytics:', err);
    } finally {
      dispatch({ type: 'SET_ANALYTICS_LOADING', loading: false });
    }
  }, [selectedTeamId, dispatch]);

  useEffect(() => {
    if (selectedTeamId) {
      fetchAnalytics();
      dispatch({ type: 'RESET_DISMISSED_SUGGESTIONS' });
    }
  }, [selectedTeamId, fetchAnalytics, dispatch]);

  // Reset pipeline/dry-run state on team switch
  useEffect(() => {
    dispatch({ type: 'RESET_ON_TEAM_SWITCH' });
  }, [selectedTeamId, dispatch]);

  // ── Pipeline status listener ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<{
      pipeline_id: string;
      team_id: string;
      status: string;
      node_statuses: PipelineNodeStatus[];
      memories_created?: number;
    }>('pipeline-status', (event) => {
      if (cancelled) return;
      if (event.payload.team_id === selectedTeamId) {
        dispatch({ type: 'SET_PIPELINE_NODE_STATUSES', statuses: event.payload.node_statuses });
        const isRunning = event.payload.status === 'running';
        dispatch({ type: 'SET_PIPELINE_RUNNING', running: isRunning });

        if ((event.payload.memories_created ?? 0) > 0 && isRunning) {
          dispatch({ type: 'SET_MEMORIES_PULSING', pulsing: true });
        }

        if (!isRunning) {
          setTimeout(() => {
            fetchAnalytics();
            if (selectedTeamId) {
              const { memoryFilterCategory: cat, memoryFilterSearch: srch } = usePersonaStore.getState();
              fetchTeamMemories(selectedTeamId, cat, srch);
            }
            dispatch({ type: 'SET_MEMORIES_PULSING', pulsing: false });
          }, 500);
        }
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlistenFn = fn; }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [selectedTeamId, fetchAnalytics, fetchTeamMemories, dispatch]);

  // ── Derived canvas state (nodes + edges from source data) ──────
  const derived = useDerivedCanvasState({
    selectedTeamId,
    teamMembers,
    teamConnections,
    personas,
    pipelineNodeStatuses: cs.pipelineNodeStatuses,
    analytics: cs.analytics,
    dismissedSuggestionIds: cs.dismissedSuggestionIds,
    dryRunState: cs.dryRunState,
    snapToGrid,
  });

  // ── Sticky note handlers ───────────────────────────────────────
  const handleAddNote = useCallback(() => {
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const count = cs.stickyNotes.length;
    const x = snapToGrid(300 + (count % 3) * 200);
    const y = snapToGrid(60 + Math.floor(count / 3) * 160);
    dispatch({ type: 'ADD_STICKY_NOTE', note: { id, x, y, text: '', category: 'documentation' } });
  }, [cs.stickyNotes.length, dispatch]);

  const handleUpdateNote = useCallback((id: string, text: string, category: StickyNoteCategory) => {
    dispatch({ type: 'UPDATE_STICKY_NOTE', id, text, category });
  }, [dispatch]);

  const handleDeleteNote = useCallback((id: string) => {
    dispatch({ type: 'DELETE_STICKY_NOTE', id });
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, [dispatch, setNodes]);

  // ── Build sticky note nodes ────────────────────────────────────
  const stickyNodes = useMemo<Node[]>(() =>
    cs.stickyNotes.map((n) => ({
      id: n.id,
      type: 'stickyNote' as const,
      position: { x: n.x, y: n.y },
      data: {
        text: n.text,
        category: n.category,
        onUpdate: handleUpdateNote,
        onDelete: handleDeleteNote,
      },
      dragHandle: '.cursor-grab',
    })),
  [cs.stickyNotes, handleUpdateNote, handleDeleteNote]);

  // ── Sync derived + sticky nodes into React Flow ────────────────
  useEffect(() => {
    setNodes((prev) => {
      const posMap = new Map(prev.map((n) => [n.id, n.position]));
      const personaNodes = derived.nodes.map((n) => ({
        ...n,
        position: posMap.get(n.id) ?? n.position,
      }));
      const noteNodes = stickyNodes.map((n) => ({
        ...n,
        position: posMap.get(n.id) ?? n.position,
      }));
      return [...personaNodes, ...noteNodes];
    });
    setEdges(derived.edges);
  }, [derived, stickyNodes, setNodes, setEdges]);

  // ── Connection validation ──────────────────────────────────────
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => connection.source !== connection.target,
    [],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target || !selectedTeamId) return;
      if (connection.source === connection.target) return;
      const duplicate = teamConnections.some(
        (c) => c.source_member_id === connection.source && c.target_member_id === connection.target,
      );
      if (duplicate) return;
      await createTeamConnection(connection.source, connection.target);
      fetchAnalytics();
    },
    [selectedTeamId, createTeamConnection, fetchAnalytics, teamConnections],
  );

  // ── Node click → config panel ──────────────────────────────────
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const member = teamMembers.find((m) => m.id === node.id);
      if (member) {
        const persona = personas.find((p) => p.id === member.persona_id);
        setSelectedMember({
          ...member,
          persona_name: persona?.name,
          persona_icon: persona?.icon ?? undefined,
          persona_color: persona?.color ?? undefined,
        });
      }
    },
    [teamMembers, personas, setSelectedMember],
  );

  // ── Add member via toolbar ─────────────────────────────────────
  const handleAddMember = useCallback(
    (personaId: string) => {
      const count = teamMembers.length;
      const posX = snapToGrid(100 + (count % 4) * 220);
      const posY = snapToGrid(80 + Math.floor(count / 4) * 140);
      addTeamMember(personaId, 'worker', posX, posY);
    },
    [teamMembers, addTeamMember],
  );

  // ── Drag-to-add ────────────────────────────────────────────────
  const displayNodes = useMemo(() => {
    if (!cs.ghostNode) return nodes;
    return [...nodes, cs.ghostNode];
  }, [nodes, cs.ghostNode]);

  const onCanvasDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/persona-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!cs.reactFlowInstance) return;

      const position = cs.reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const x = snapToGrid(position.x);
      const y = snapToGrid(position.y);

      if (x === lastGhostPos.current.x && y === lastGhostPos.current.y) return;
      lastGhostPos.current = { x, y };

      const personaId = canvasDragRef.current;
      const persona = personaId ? personas.find((p) => p.id === personaId) : null;

      setGhostNode({
        id: '__ghost-drop__',
        type: 'persona',
        position: { x, y },
        data: {
          name: persona?.name || 'Agent',
          icon: persona?.icon || '',
          color: persona?.color || '#6366f1',
          role: 'worker',
          memberId: '__ghost-drop__',
          personaId: personaId || '',
          isGhost: true,
        },
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
      });
    },
    [cs.reactFlowInstance, personas, setGhostNode, canvasDragRef],
  );

  const onCanvasDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !e.currentTarget.contains(related)) {
      setGhostNode(null);
      lastGhostPos.current = { x: 0, y: 0 };
    }
  }, [setGhostNode]);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setGhostNode(null);
      lastGhostPos.current = { x: 0, y: 0 };

      const personaId = e.dataTransfer.getData('application/persona-id');
      if (!personaId || !cs.reactFlowInstance) return;

      const position = cs.reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addTeamMember(personaId, 'worker', snapToGrid(position.x), snapToGrid(position.y));
    },
    [cs.reactFlowInstance, addTeamMember, setGhostNode],
  );

  // ── Save ───────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedTeamId) return;
    setSaveStatus('saving');
    try {
      await Promise.all(
        nodes
          .filter((n) => n.type !== 'stickyNote')
          .map((n) => api.updateTeamMember(n.id, undefined, n.position.x, n.position.y)),
      );
      setSaveStatus('saved');
    } catch (err) {
      console.error('Failed to save canvas:', err);
      setSaveStatus('unsaved');
    }
  }, [selectedTeamId, nodes, setSaveStatus]);

  saveRef.current = handleSave;

  // ── Node changes (drag, position sync, auto-save) ─────────────
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChangeBase(changes);
      const hasPositionChange = changes.some((c) => c.type === 'position' && !c.dragging);
      if (hasPositionChange) {
        for (const c of changes) {
          if (c.type === 'position' && !c.dragging && c.position && c.id.startsWith('note-')) {
            dispatch({ type: 'UPDATE_STICKY_NOTE_POSITION', id: c.id, x: c.position.x, y: c.position.y });
          }
        }
        setSaveStatus('unsaved');
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => { saveRef.current(); }, 1500);
      }
    },
    [onNodesChangeBase, dispatch, setSaveStatus],
  );

  // ── Alignment guides ──────────────────────────────────────────
  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      dispatch({ type: 'SET_IS_DRAGGING_NODE', dragging: true });
      dispatch({ type: 'SET_ALIGNMENT_LINES', lines: computeAlignments(node, nodes) });
    },
    [nodes, dispatch],
  );

  const onNodeDragStop = useCallback(() => {
    dispatch({ type: 'SET_IS_DRAGGING_NODE', dragging: false });
  }, [dispatch]);

  // Clean up auto-save timer on unmount
  useEffect(() => {
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, []);

  // ── Auto-layout ────────────────────────────────────────────────
  const handleAutoLayout = useCallback(() => {
    setSaveStatus('unsaved');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { saveRef.current(); }, 1500);
    setNodes((nds) => {
      if (nds.length === 0) return nds;
      if (nds.length === 1) {
        return [{ ...nds[0]!, position: { x: snapToGrid(200), y: snapToGrid(120) } }];
      }

      const nodeWidth = 180;
      const nodeHeight = 70;
      const xGap = 60;
      const yGap = 100;

      const graph = buildTeamGraph(nds.map((n) => n.id), teamConnections);

      const layerGroups = new Map<number, number[]>();
      nds.forEach((n, i) => {
        const layer = graph.layers.get(n.id) ?? 0;
        if (!layerGroups.has(layer)) layerGroups.set(layer, []);
        layerGroups.get(layer)!.push(i);
      });

      const maxPerLayer = Math.max(...Array.from(layerGroups.values()).map((g) => g.length));
      const totalWidth = maxPerLayer * (nodeWidth + xGap);

      return nds.map((node, i) => {
        const layerIdx = graph.layers.get(node.id) ?? 0;
        const nodesInLayer = layerGroups.get(layerIdx)!;
        const posInLayer = nodesInLayer.indexOf(i);
        const count = nodesInLayer.length;
        const layerWidth = count * (nodeWidth + xGap) - xGap;
        const startX = (totalWidth - layerWidth) / 2 + 80;
        const x = snapToGrid(startX + posInLayer * (nodeWidth + xGap));
        const y = snapToGrid(80 + layerIdx * (nodeHeight + yGap));
        return { ...node, position: { x, y } };
      });
    });
  }, [setNodes, teamConnections, setSaveStatus]);

  // ── Role change / member removal ───────────────────────────────
  const handleRoleChange = useCallback(
    async (memberId: string, newRole: string) => {
      dispatch({ type: 'UPDATE_SELECTED_MEMBER_ROLE', memberId, role: newRole });
      try {
        await api.updateTeamMember(memberId, newRole);
      } catch (err) {
        console.error('Failed to update member role:', err);
      }
    },
    [dispatch],
  );

  const handleRemoveMember = useCallback(
    (memberId: string) => {
      removeTeamMember(memberId);
      setSelectedMember(null);
    },
    [removeTeamMember, setSelectedMember],
  );

  // ── Edge click / delete / type change ──────────────────────────
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (edge.type === 'ghost') return;
      setEdgeTooltip({ x: event.clientX, y: event.clientY, edge });
    },
    [setEdgeTooltip],
  );

  const handleDeleteEdge = useCallback(async () => {
    if (!cs.edgeTooltip || !selectedTeamId) return;
    await deleteTeamConnection(cs.edgeTooltip.edge.id);
    fetchAnalytics();
    setEdgeTooltip(null);
  }, [cs.edgeTooltip, selectedTeamId, deleteTeamConnection, fetchAnalytics, setEdgeTooltip]);

  const handleChangeConnectionType = useCallback(
    async (newType: string) => {
      if (!cs.edgeTooltip || !selectedTeamId) return;
      await updateTeamConnection(cs.edgeTooltip.edge.id, newType);
      setEdgeTooltip(null);
    },
    [cs.edgeTooltip, selectedTeamId, updateTeamConnection, setEdgeTooltip],
  );

  // ── Node context menu ──────────────────────────────────────────
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const member = teamMembers.find((m) => m.id === node.id);
      if (member) {
        const persona = personas.find((p) => p.id === member.persona_id);
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          member: {
            ...member,
            persona_name: persona?.name,
            persona_icon: persona?.icon ?? undefined,
            persona_color: persona?.color ?? undefined,
          },
        });
      }
    },
    [teamMembers, personas, setContextMenu],
  );

  // ── Execute team pipeline ──────────────────────────────────────
  const handleExecuteTeam = useCallback(async () => {
    if (!selectedTeamId || cs.pipelineRunning) return;
    try {
      dispatch({ type: 'SET_PIPELINE_RUNNING', running: true });
      await api.executeTeam(selectedTeamId);
    } catch (err) {
      console.error('Failed to execute team:', err);
      dispatch({ type: 'SET_PIPELINE_RUNNING', running: false });
    }
  }, [selectedTeamId, cs.pipelineRunning, dispatch]);

  // ── Optimizer suggestion handlers ──────────────────────────────
  const handleAcceptSuggestion = useCallback(
    async (suggestion: TopologySuggestion) => {
      if (!selectedTeamId) return;
      if (suggestion.suggested_source && suggestion.suggested_target) {
        await createTeamConnection(
          suggestion.suggested_source,
          suggestion.suggested_target,
          suggestion.suggested_connection_type ?? undefined,
        );
        dispatch({ type: 'DISMISS_SUGGESTION', suggestionId: suggestion.id });
        fetchAnalytics();
      } else {
        dispatch({ type: 'DISMISS_SUGGESTION', suggestionId: suggestion.id });
      }
    },
    [selectedTeamId, createTeamConnection, fetchAnalytics, dispatch],
  );

  const handleDismissSuggestion = useCallback((suggestionId: string) => {
    dispatch({ type: 'DISMISS_SUGGESTION', suggestionId });
  }, [dispatch]);

  // ── Canvas assistant ───────────────────────────────────────────
  const handleAssistantSuggest = useCallback(
    async (query: string) => {
      try {
        return await api.suggestTopologyLlm(query, selectedTeamId ?? undefined);
      } catch (err) {
        console.warn('LLM topology failed, falling back to keyword-based:', err);
        return api.suggestTopology(query, selectedTeamId ?? undefined);
      }
    },
    [selectedTeamId],
  );

  const handleAssistantApply = useCallback(
    async (blueprint: import('@/lib/bindings/TopologyBlueprint').TopologyBlueprint) => {
      if (!selectedTeamId) return;
      dispatch({ type: 'SET_ASSISTANT_APPLYING', applying: true });
      try {
        const newMemberIds: string[] = [];
        for (const m of blueprint.members) {
          const member = await addTeamMember(m.persona_id, m.role, m.position_x, m.position_y);
          if (member) newMemberIds.push(member.id);
        }
        for (const c of blueprint.connections) {
          const sourceId = newMemberIds[c.source_index];
          const targetId = newMemberIds[c.target_index];
          if (sourceId && targetId) {
            await createTeamConnection(sourceId, targetId, c.connection_type);
          }
        }
        fetchAnalytics();
      } catch (err) {
        console.error('Failed to apply blueprint:', err);
      } finally {
        dispatch({ type: 'SET_ASSISTANT_APPLYING', applying: false });
      }
    },
    [selectedTeamId, addTeamMember, createTeamConnection, fetchAnalytics, dispatch],
  );

  // ── Dry-run handlers ───────────────────────────────────────────
  const handleStartDryRun = useCallback(() => {
    if (cs.pipelineRunning || teamMembers.length === 0) return;
    dispatch({ type: 'SET_DRY_RUN_ACTIVE', active: true });
  }, [cs.pipelineRunning, teamMembers.length, dispatch]);

  const handleDryRunStateChange = useCallback((state: DryRunState) => {
    dispatch({ type: 'SET_DRY_RUN_STATE', state });
  }, [dispatch]);

  const handleCloseDryRun = useCallback(() => {
    dispatch({ type: 'SET_DRY_RUN_ACTIVE', active: false });
    dispatch({ type: 'SET_DRY_RUN_STATE', state: null });
  }, [dispatch]);

  // ── Early return: no team selected ─────────────────────────────
  if (!selectedTeamId) {
    return <TeamList />;
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <ContentBox minWidth={0}>
      <div className="relative z-10">
        <TeamToolbar
          teamName={selectedTeam?.name || 'Team'}
          onBack={() => {
            if (autoSaveTimer.current) {
              clearTimeout(autoSaveTimer.current);
              autoSaveTimer.current = null;
            }
            if (cs.saveStatus === 'unsaved') {
              handleSave().then(() => selectTeam(null));
            } else {
              selectTeam(null);
            }
          }}
          onAutoLayout={handleAutoLayout}
          onSave={handleSave}
          onAddMember={handleAddMember}
          onAddNote={handleAddNote}
          saveStatus={cs.saveStatus}
        />
      </div>

      <div
        className="flex-1 relative"
        onDrop={onCanvasDrop}
        onDragOver={onCanvasDragOver}
        onDragLeave={onCanvasDragLeave}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onInit={setReactFlowInstance}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={() => { setContextMenu(null); setEdgeTooltip(null); }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          snapToGrid
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          className="bg-background"
          defaultEdgeOptions={{ type: 'connection' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} className="opacity-30" />
          <Controls className="!bg-secondary/60 !border-primary/15 !rounded-xl !shadow-lg [&>button]:!bg-secondary/80 [&>button]:!border-primary/15 [&>button]:!text-foreground/80 [&>button:hover]:!bg-secondary [&>button:hover]:!text-foreground/90" />
          <MiniMap
            className="!bg-secondary/40 !border-primary/15 !rounded-xl"
            maskColor="rgba(0,0,0,0.3)"
            nodeColor={(n) => (n.data as Record<string, string>)?.color || '#6366f1'}
          />
          <AlignmentGuides lines={cs.alignmentLines} isDragging={cs.isDraggingNode} />
        </ReactFlow>

        <ConnectionLegend />

        <TeamMemoryBadge
          count={teamMemoriesTotal}
          isOpen={cs.memoryPanelOpen}
          isPulsing={cs.memoriesPulsing}
          onClick={() => dispatch({ type: 'SET_MEMORY_PANEL_OPEN', open: true })}
        />

        <AnimatePresence>
          {cs.memoryPanelOpen && selectedTeamId && (
            <TeamMemoryPanel
              teamId={selectedTeamId}
              memories={teamMemories}
              total={teamMemoriesTotal}
              stats={teamMemoryStats}
              onClose={() => dispatch({ type: 'SET_MEMORY_PANEL_OPEN', open: false })}
              onDelete={deleteTeamMemory}
              onImportanceChange={updateTeamMemoryImportance}
              onCreate={createTeamMemory}
              onFilter={(category, search) => {
                if (selectedTeamId) fetchTeamMemories(selectedTeamId, category, search);
              }}
              onLoadMore={() => selectedTeamId ? loadMoreTeamMemories(selectedTeamId, memoryFilterCategory, memoryFilterSearch) : Promise.resolve()}
              onEdit={(id, title, content, category, importance) => updateTeamMemory(id, title, content, category, importance)}
            />
          )}
        </AnimatePresence>

        <CanvasAssistant
          onSuggest={handleAssistantSuggest}
          onApply={handleAssistantApply}
          isApplying={cs.assistantApplying}
          memberCount={teamMembers.length}
        />

        {teamMembers.length > 0 && (
          <OptimizerPanel
            analytics={cs.analytics}
            loading={cs.analyticsLoading}
            onAcceptSuggestion={handleAcceptSuggestion}
            onDismissSuggestion={handleDismissSuggestion}
            onRefresh={fetchAnalytics}
            dismissedIds={cs.dismissedSuggestionIds}
          />
        )}

        {!cs.dryRunActive && (
          <PipelineControls
            teamId={selectedTeamId}
            isRunning={cs.pipelineRunning}
            isDryRunActive={cs.dryRunActive}
            nodeStatuses={cs.pipelineNodeStatuses}
            onExecute={handleExecuteTeam}
            onDryRun={handleStartDryRun}
            agentNames={agentNames}
          />
        )}

        {cs.dryRunActive && (
          <DryRunDebugger
            members={teamMembers}
            connections={teamConnections}
            agentNames={agentNames}
            agentRoles={agentRoles}
            onStateChange={handleDryRunStateChange}
            onClose={handleCloseDryRun}
          />
        )}

        {cs.selectedMember && (
          <TeamConfigPanel
            member={cs.selectedMember}
            onClose={() => setSelectedMember(null)}
            onRoleChange={handleRoleChange}
            onRemove={handleRemoveMember}
          />
        )}

        {cs.contextMenu && (
          <NodeContextMenu
            x={cs.contextMenu.x}
            y={cs.contextMenu.y}
            memberName={cs.contextMenu.member.persona_name || 'Agent'}
            currentRole={cs.contextMenu.member.role || 'worker'}
            onChangeRole={(role) => handleRoleChange(cs.contextMenu!.member.id, role)}
            onRemove={() => { handleRemoveMember(cs.contextMenu!.member.id); setContextMenu(null); }}
            onConfigure={() => { setSelectedMember(cs.contextMenu!.member); setContextMenu(null); }}
            onClose={() => setContextMenu(null)}
          />
        )}

        <AnimatePresence>
          {cs.edgeTooltip && (
            <EdgeDeleteTooltip
              x={cs.edgeTooltip.x}
              y={cs.edgeTooltip.y}
              connectionType={(cs.edgeTooltip.edge.data as Record<string, unknown>)?.connection_type as string || 'sequential'}
              label={(cs.edgeTooltip.edge.data as Record<string, unknown>)?.label as string || ''}
              onDelete={handleDeleteEdge}
              onChangeType={handleChangeConnectionType}
              onClose={() => setEdgeTooltip(null)}
            />
          )}
        </AnimatePresence>

        {teamMembers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <Users className="w-8 h-8 text-indigo-400/50" />
              </div>
              <p className="text-sm font-medium text-foreground/80 mb-1">No agents in this team</p>
              <p className="text-sm text-muted-foreground/80">Drag agents from the sidebar or click &quot;Add Agent&quot; above</p>
            </div>
          </div>
        )}
      </div>
    </ContentBox>
  );
}
