import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AnimatePresence } from 'framer-motion';
import { Users } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox } from '@/features/shared/components/ContentLayout';
import * as api from '@/api/tauriApi';
import { useDerivedCanvasState, type PipelineNodeStatus } from '@/features/pipeline/sub_canvas/useDerivedCanvasState';
import TeamList from '@/features/pipeline/components/TeamList';
import PersonaNode from '@/features/pipeline/sub_canvas/PersonaNode';
import ConnectionEdge from '@/features/pipeline/sub_canvas/ConnectionEdge';
import GhostEdge from '@/features/pipeline/sub_canvas/GhostEdge';
import TeamToolbar from '@/features/pipeline/sub_canvas/TeamToolbar';
import TeamConfigPanel from '@/features/pipeline/components/TeamConfigPanel';
import NodeContextMenu from '@/features/pipeline/sub_canvas/NodeContextMenu';
import EdgeDeleteTooltip from '@/features/pipeline/sub_canvas/EdgeDeleteTooltip';
import PipelineControls from '@/features/pipeline/sub_canvas/PipelineControls';
import OptimizerPanel from '@/features/pipeline/sub_canvas/OptimizerPanel';
import CanvasAssistant from '@/features/pipeline/sub_canvas/CanvasAssistant';
import DryRunDebugger, { type DryRunState } from '@/features/pipeline/sub_canvas/DryRunDebugger';
import AlignmentGuides, { computeAlignments, type AlignmentLine } from '@/features/pipeline/sub_canvas/AlignmentGuides';
import ConnectionLegend from '@/features/pipeline/sub_canvas/ConnectionLegend';
import { canvasDragState } from '@/features/pipeline/sub_canvas/teamConstants';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import type { PipelineAnalytics } from '@/lib/bindings/PipelineAnalytics';
import type { TopologySuggestion } from '@/lib/bindings/TopologySuggestion';

const nodeTypes = { persona: PersonaNode };
const edgeTypes = { connection: ConnectionEdge, ghost: GhostEdge };

interface MemberWithPersonaInfo extends PersonaTeamMember {
  persona_name?: string;
  persona_icon?: string;
  persona_color?: string;
}

export default function TeamCanvas() {
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

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [selectedMember, setSelectedMember] = useState<MemberWithPersonaInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; member: MemberWithPersonaInfo } | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<{ x: number; y: number; edge: Edge } | null>(null);

  // Drag-to-add state
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [ghostNode, setGhostNode] = useState<Node | null>(null);
  const lastGhostPos = useRef({ x: 0, y: 0 });

  const GRID_SIZE = 24;
  const snapToGrid = useCallback((v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE, []);

  // Pipeline state
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineNodeStatuses, setPipelineNodeStatuses] = useState<PipelineNodeStatus[]>([]);

  // Dry-run state
  const [dryRunActive, setDryRunActive] = useState(false);
  const [dryRunState, setDryRunState] = useState<DryRunState | null>(null);

  // Alignment guides state
  const [alignmentLines, setAlignmentLines] = useState<AlignmentLine[]>([]);
  const [isDraggingNode, setIsDraggingNode] = useState(false);

  // Optimizer state
  const [analytics, setAnalytics] = useState<PipelineAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<Set<string>>(new Set());

  const selectedTeam = useMemo(
    () => teams.find((t: PersonaTeam) => t.id === selectedTeamId),
    [teams, selectedTeamId],
  );

  // Map member_id -> persona name for human-readable pipeline status
  const agentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of teamMembers) {
      const persona = personas.find((p) => p.id === m.persona_id);
      map[m.id] = persona?.name || 'Agent';
    }
    return map;
  }, [teamMembers, personas]);

  // Map member_id -> role for dry-run mock data
  const agentRoles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of teamMembers) {
      map[m.id] = m.role || 'worker';
    }
    return map;
  }, [teamMembers]);

  // Fetch analytics when team is selected or pipeline finishes
  const fetchAnalytics = useCallback(async () => {
    if (!selectedTeamId) return;
    setAnalyticsLoading(true);
    try {
      const data = await api.getPipelineAnalytics(selectedTeamId);
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to fetch pipeline analytics:', err);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [selectedTeamId]);

  useEffect(() => {
    if (selectedTeamId) {
      fetchAnalytics();
      setDismissedSuggestionIds(new Set());
    }
  }, [selectedTeamId, fetchAnalytics]);

  // Reset pipeline/dry-run state on team switch so stale running state
  // from the previous team doesn't disable buttons on the new team.
  useEffect(() => {
    setPipelineRunning(false);
    setPipelineNodeStatuses([]);
    setDryRunActive(false);
    setDryRunState(null);
  }, [selectedTeamId]);

  // Listen for pipeline-status events from the Rust backend
  useEffect(() => {
    const unlisten = listen<{
      pipeline_id: string;
      team_id: string;
      status: string;
      node_statuses: PipelineNodeStatus[];
    }>('pipeline-status', (event) => {
      if (event.payload.team_id === selectedTeamId) {
        setPipelineNodeStatuses(event.payload.node_statuses);
        const isRunning = event.payload.status === 'running';
        setPipelineRunning(isRunning);
        // Refresh analytics when pipeline completes
        if (!isRunning) {
          setTimeout(fetchAnalytics, 500);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [selectedTeamId, fetchAnalytics]);

  // Single-pass derivation of all nodes and edges from source data.
  // Replaces 5 separate useEffect hooks (base nodes, pipeline status,
  // optimizer highlights, edges + ghost edges, edge active state).
  const derived = useDerivedCanvasState({
    selectedTeamId,
    teamMembers,
    teamConnections,
    personas,
    pipelineNodeStatuses,
    analytics,
    dismissedSuggestionIds,
    dryRunState,
    snapToGrid,
  });

  // Sync derived state into React Flow's interactive state.
  // Preserves node positions from drag interactions so in-progress
  // drags aren't reset when enrichment data changes.
  useEffect(() => {
    setNodes((prev) => {
      const posMap = new Map(prev.map((n) => [n.id, n.position]));
      return derived.nodes.map((n) => ({
        ...n,
        position: posMap.get(n.id) ?? n.position,
      }));
    });
    setEdges(derived.edges);
  }, [derived, setNodes, setEdges]);

  // Reject self-loops at the React Flow drag level
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      return connection.source !== connection.target;
    },
    [],
  );

  // Handle new edge connection -- persist to DB (optimistic)
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target || !selectedTeamId) return;

      // Guard: reject self-loops
      if (connection.source === connection.target) return;

      // Guard: reject duplicate edges
      const duplicate = teamConnections.some(
        (c) =>
          c.source_member_id === connection.source &&
          c.target_member_id === connection.target,
      );
      if (duplicate) return;

      await createTeamConnection(connection.source, connection.target);
      fetchAnalytics();
    },
    [selectedTeamId, createTeamConnection, fetchAnalytics, teamConnections],
  );

  // Handle node click for config panel
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
    [teamMembers, personas],
  );

  // Handle adding a member via toolbar
  const handleAddMember = useCallback(
    (personaId: string) => {
      const count = teamMembers.length;
      const posX = snapToGrid(100 + (count % 4) * 220);
      const posY = snapToGrid(80 + Math.floor(count / 4) * 140);
      addTeamMember(personaId, 'worker', posX, posY);
    },
    [teamMembers, addTeamMember, snapToGrid],
  );

  // Drag-to-add: combine real nodes with ghost preview
  const displayNodes = useMemo(() => {
    if (!ghostNode) return nodes;
    return [...nodes, ghostNode];
  }, [nodes, ghostNode]);

  // Drag-to-add: handle dragover to show ghost preview
  const onCanvasDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/persona-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      if (!reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const x = snapToGrid(position.x);
      const y = snapToGrid(position.y);

      if (x === lastGhostPos.current.x && y === lastGhostPos.current.y) return;
      lastGhostPos.current = { x, y };

      const personaId = canvasDragState.personaId;
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
    [reactFlowInstance, personas, snapToGrid],
  );

  // Drag-to-add: clear ghost on drag leave
  const onCanvasDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !e.currentTarget.contains(related)) {
      setGhostNode(null);
      lastGhostPos.current = { x: 0, y: 0 };
    }
  }, []);

  // Drag-to-add: create member on drop
  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setGhostNode(null);
      lastGhostPos.current = { x: 0, y: 0 };

      const personaId = e.dataTransfer.getData('application/persona-id');
      if (!personaId || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const x = snapToGrid(position.x);
      const y = snapToGrid(position.y);

      addTeamMember(personaId, 'worker', x, y);
    },
    [reactFlowInstance, addTeamMember, snapToGrid],
  );

  // Save canvas data (node positions) to backend -- persists positions to member records
  const handleSave = useCallback(async () => {
    if (!selectedTeamId) return;
    setSaveStatus('saving');
    try {
      await Promise.all(
        nodes.map((n) =>
          api.updateTeamMember(n.id, undefined, n.position.x, n.position.y),
        ),
      );
      setSaveStatus('saved');
    } catch (err) {
      console.error('Failed to save canvas:', err);
      setSaveStatus('unsaved');
    }
  }, [selectedTeamId, nodes]);

  // Keep ref in sync for stable timer callbacks
  saveRef.current = handleSave;

  // Wrap onNodesChange to detect position drags and trigger debounced auto-save
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChangeBase(changes);
      const hasPositionChange = changes.some(
        (c) => c.type === 'position' && !c.dragging,
      );
      if (hasPositionChange) {
        setSaveStatus('unsaved');
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => {
          saveRef.current();
        }, 1500);
      }
    },
    [onNodesChangeBase],
  );

  // Alignment guides: compute lines on every drag tick
  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setIsDraggingNode(true);
      setAlignmentLines(computeAlignments(node, nodes));
    },
    [nodes],
  );

  const onNodeDragStop = useCallback(() => {
    setIsDraggingNode(false);
  }, []);

  // Clean up auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, []);

  // Graph-aware DAG layout (Sugiyama-style layered layout)
  const handleAutoLayout = useCallback(() => {
    setSaveStatus('unsaved');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveRef.current();
    }, 1500);
    setNodes((nds) => {
      if (nds.length === 0) return nds;
      if (nds.length === 1) {
        return [{ ...nds[0]!, position: { x: snapToGrid(200), y: snapToGrid(120) } }];
      }

      const nodeCount = nds.length;
      const nodeWidth = 180;
      const nodeHeight = 70;
      const xGap = 60;
      const yGap = 100;

      // Build adjacency + in-degree from current edges
      const nodeIdToIdx = new Map(nds.map((n, i) => [n.id, i]));
      const inDeg = new Array(nodeCount).fill(0) as number[];
      const adj: number[][] = Array.from({ length: nodeCount }, () => []);

      for (const conn of teamConnections) {
        const si = nodeIdToIdx.get(conn.source_member_id);
        const ti = nodeIdToIdx.get(conn.target_member_id);
        if (si !== undefined && ti !== undefined) {
          adj[si]!.push(ti);
          inDeg[ti] = (inDeg[ti] ?? 0) + 1;
        }
      }

      // Kahn's topological sort for layer assignment
      const layers = new Array(nodeCount).fill(0) as number[];
      const queue: number[] = [];
      const inDegCopy = [...inDeg];
      for (let i = 0; i < nodeCount; i++) {
        if (inDegCopy[i] === 0) queue.push(i);
      }

      while (queue.length > 0) {
        const node = queue.shift()!;
        for (const neighbor of adj[node]!) {
          layers[neighbor] = Math.max(layers[neighbor]!, (layers[node] ?? 0) + 1);
          inDegCopy[neighbor] = (inDegCopy[neighbor] ?? 1) - 1;
          if (inDegCopy[neighbor] === 0) queue.push(neighbor);
        }
      }

      // Handle cycles
      const maxLayer = Math.max(...layers);
      for (let i = 0; i < nodeCount; i++) {
        if ((inDegCopy[i] ?? 0) > 0) layers[i] = maxLayer + 1;
      }

      // Group by layer
      const totalLayers = Math.max(...layers) + 1;
      const layerNodes: number[][] = Array.from({ length: totalLayers }, () => []);
      for (let i = 0; i < nodeCount; i++) {
        layerNodes[layers[i]!]!.push(i);
      }

      // Position nodes centered per layer
      const maxPerLayer = Math.max(...layerNodes.map((l) => l.length));
      const totalWidth = maxPerLayer * (nodeWidth + xGap);

      return nds.map((node, i) => {
        const layerIdx = layers[i]!;
        const nodesInLayer = layerNodes[layerIdx]!;
        const posInLayer = nodesInLayer.indexOf(i);
        const count = nodesInLayer.length;
        const layerWidth = count * (nodeWidth + xGap) - xGap;
        const startX = (totalWidth - layerWidth) / 2 + 80;
        const x = snapToGrid(startX + posInLayer * (nodeWidth + xGap));
        const y = snapToGrid(80 + layerIdx * (nodeHeight + yGap));
        return { ...node, position: { x, y } };
      });
    });
  }, [setNodes, teamConnections, snapToGrid]);

  // Handle role change from config panel -- persist to DB
  // Role flows through derivation (teamMembers → useMemo → sync effect)
  const handleRoleChange = useCallback(
    async (memberId: string, newRole: string) => {
      setSelectedMember((prev) => (prev?.id === memberId ? { ...prev, role: newRole } : prev));
      try {
        await api.updateTeamMember(memberId, newRole);
      } catch (err) {
        console.error('Failed to update member role:', err);
      }
    },
    [],
  );

  // Handle member removal from config panel
  const handleRemoveMember = useCallback(
    (memberId: string) => {
      removeTeamMember(memberId);
      setSelectedMember(null);
    },
    [removeTeamMember],
  );

  // Handle edge click — show confirmation tooltip
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      // Don't show delete tooltip for ghost edges
      if (edge.type === 'ghost') return;
      setEdgeTooltip({ x: event.clientX, y: event.clientY, edge });
    },
    [],
  );

  // Handle confirmed edge deletion (optimistic)
  const handleDeleteEdge = useCallback(async () => {
    if (!edgeTooltip || !selectedTeamId) return;
    await deleteTeamConnection(edgeTooltip.edge.id);
    fetchAnalytics();
    setEdgeTooltip(null);
  }, [edgeTooltip, selectedTeamId, deleteTeamConnection, fetchAnalytics]);

  // Handle connection type change from edge tooltip (optimistic)
  const handleChangeConnectionType = useCallback(
    async (newType: string) => {
      if (!edgeTooltip || !selectedTeamId) return;
      await updateTeamConnection(edgeTooltip.edge.id, newType);
      setEdgeTooltip(null);
    },
    [edgeTooltip, selectedTeamId, updateTeamConnection],
  );

  // Handle node right-click context menu
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
    [teamMembers, personas],
  );

  // Execute the team pipeline
  const handleExecuteTeam = useCallback(async () => {
    if (!selectedTeamId || pipelineRunning) return;
    try {
      setPipelineRunning(true);
      await api.executeTeam(selectedTeamId);
    } catch (err) {
      console.error('Failed to execute team:', err);
      setPipelineRunning(false);
    }
  }, [selectedTeamId, pipelineRunning]);

  // Accept an optimizer suggestion — create the suggested connection (optimistic)
  const handleAcceptSuggestion = useCallback(
    async (suggestion: TopologySuggestion) => {
      if (!selectedTeamId) return;

      if (suggestion.suggested_source && suggestion.suggested_target) {
        await createTeamConnection(
          suggestion.suggested_source,
          suggestion.suggested_target,
          suggestion.suggested_connection_type ?? undefined,
        );
        setDismissedSuggestionIds((prev) => new Set([...prev, suggestion.id]));
        fetchAnalytics();
      } else {
        // For non-connection suggestions (remove, reorder), just dismiss
        setDismissedSuggestionIds((prev) => new Set([...prev, suggestion.id]));
      }
    },
    [selectedTeamId, createTeamConnection, fetchAnalytics],
  );

  // Dismiss a suggestion
  const handleDismissSuggestion = useCallback((suggestionId: string) => {
    setDismissedSuggestionIds((prev) => new Set([...prev, suggestionId]));
  }, []);

  // Canvas Assistant state
  const [assistantApplying, setAssistantApplying] = useState(false);

  // Canvas Assistant: suggest topology from natural language
  const handleAssistantSuggest = useCallback(
    async (query: string) => {
      return api.suggestTopology(query, selectedTeamId ?? undefined);
    },
    [selectedTeamId],
  );

  // Canvas Assistant: apply a blueprint — add members, connections, and positions (optimistic)
  const handleAssistantApply = useCallback(
    async (blueprint: import('@/lib/bindings/TopologyBlueprint').TopologyBlueprint) => {
      if (!selectedTeamId) return;
      setAssistantApplying(true);
      try {
        // Add members sequentially — each resolves to real member with DB-assigned ID
        const newMemberIds: string[] = [];
        for (const m of blueprint.members) {
          const member = await addTeamMember(m.persona_id, m.role, m.position_x, m.position_y);
          if (member) newMemberIds.push(member.id);
        }

        // Create connections using the resolved member IDs (optimistic)
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
        setAssistantApplying(false);
      }
    },
    [selectedTeamId, addTeamMember, createTeamConnection, fetchAnalytics],
  );

  // Dry-run handlers
  const handleStartDryRun = useCallback(() => {
    if (pipelineRunning || teamMembers.length === 0) return;
    setDryRunActive(true);
  }, [pipelineRunning, teamMembers.length]);

  // Dry-run state changes flow through derivation (dryRunState → useMemo → sync effect)
  const handleDryRunStateChange = useCallback((state: DryRunState) => {
    setDryRunState(state);
  }, []);

  const handleCloseDryRun = useCallback(() => {
    setDryRunActive(false);
    setDryRunState(null);
  }, []);

  // If no team selected, show list
  if (!selectedTeamId) {
    return <TeamList />;
  }

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
            if (saveStatus === 'unsaved') {
              handleSave().then(() => selectTeam(null));
            } else {
              selectTeam(null);
            }
          }}
          onAutoLayout={handleAutoLayout}
          onSave={handleSave}
          onAddMember={handleAddMember}
          saveStatus={saveStatus}
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
          <AlignmentGuides lines={alignmentLines} isDragging={isDraggingNode} />
        </ReactFlow>

        {/* Connection Type Legend */}
        <ConnectionLegend />

        {/* Canvas Assistant */}
        <CanvasAssistant
          onSuggest={handleAssistantSuggest}
          onApply={handleAssistantApply}
          isApplying={assistantApplying}
          memberCount={teamMembers.length}
        />

        {/* Topology Optimizer Panel */}
        {teamMembers.length > 0 && (
          <OptimizerPanel
            analytics={analytics}
            loading={analyticsLoading}
            onAcceptSuggestion={handleAcceptSuggestion}
            onDismissSuggestion={handleDismissSuggestion}
            onRefresh={fetchAnalytics}
            dismissedIds={dismissedSuggestionIds}
          />
        )}

        {/* Pipeline Controls — hidden during dry-run (replaced by debugger bar) */}
        {!dryRunActive && (
          <PipelineControls
            teamId={selectedTeamId}
            isRunning={pipelineRunning}
            isDryRunActive={dryRunActive}
            nodeStatuses={pipelineNodeStatuses}
            onExecute={handleExecuteTeam}
            onDryRun={handleStartDryRun}
            agentNames={agentNames}
          />
        )}

        {/* Dry-Run Debugger */}
        {dryRunActive && (
          <DryRunDebugger
            members={teamMembers}
            connections={teamConnections}
            agentNames={agentNames}
            agentRoles={agentRoles}
            onStateChange={handleDryRunStateChange}
            onClose={handleCloseDryRun}
          />
        )}

        {/* Config Panel */}
        {selectedMember && (
          <TeamConfigPanel
            member={selectedMember}
            onClose={() => setSelectedMember(null)}
            onRoleChange={handleRoleChange}
            onRemove={handleRemoveMember}
          />
        )}

        {/* Context Menu */}
        {contextMenu && (
          <NodeContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            memberName={contextMenu.member.persona_name || 'Agent'}
            currentRole={contextMenu.member.role || 'worker'}
            onChangeRole={(role) => handleRoleChange(contextMenu.member.id, role)}
            onRemove={() => { handleRemoveMember(contextMenu.member.id); setContextMenu(null); }}
            onConfigure={() => { setSelectedMember(contextMenu.member); setContextMenu(null); }}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Edge Delete Tooltip */}
        <AnimatePresence>
          {edgeTooltip && (
            <EdgeDeleteTooltip
              x={edgeTooltip.x}
              y={edgeTooltip.y}
              connectionType={(edgeTooltip.edge.data as Record<string, unknown>)?.connection_type as string || 'sequential'}
              label={(edgeTooltip.edge.data as Record<string, unknown>)?.label as string || ''}
              onDelete={handleDeleteEdge}
              onChangeType={handleChangeConnectionType}
              onClose={() => setEdgeTooltip(null)}
            />
          )}
        </AnimatePresence>

        {/* Empty state */}
        {teamMembers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
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
