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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AnimatePresence } from 'framer-motion';
import { Users } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox } from '@/features/shared/components/ContentLayout';
import * as api from '@/api/tauriApi';
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

interface PipelineNodeStatus {
  member_id: string;
  persona_id: string;
  status: string;
  execution_id?: string;
  output?: string;
  error?: string;
}

export default function TeamCanvas() {
  const selectedTeamId = usePersonaStore((s) => s.selectedTeamId);
  const selectTeam = usePersonaStore((s) => s.selectTeam);
  const teams = usePersonaStore((s) => s.teams);
  const teamMembers = usePersonaStore((s) => s.teamMembers) as PersonaTeamMember[];
  const teamConnections = usePersonaStore((s) => s.teamConnections) as PersonaTeamConnection[];
  const addTeamMember = usePersonaStore((s) => s.addTeamMember);
  const removeTeamMember = usePersonaStore((s) => s.removeTeamMember);
  const fetchTeamDetails = usePersonaStore((s) => s.fetchTeamDetails);
  const personas = usePersonaStore((s) => s.personas);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [selectedMember, setSelectedMember] = useState<MemberWithPersonaInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; member: MemberWithPersonaInfo } | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<{ x: number; y: number; edge: Edge } | null>(null);

  // Pipeline state
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineNodeStatuses, setPipelineNodeStatuses] = useState<PipelineNodeStatus[]>([]);

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

  // Convert teamMembers to React Flow nodes
  useEffect(() => {
    if (!selectedTeamId) return;

    const edgeCount = teamConnections.length;
    const newNodes: Node[] = teamMembers.map((m, i) => {
      const persona = personas.find((p) => p.id === m.persona_id);
      return {
        id: m.id,
        type: 'persona',
        position: {
          x: m.position_x ?? 100 + (i % 4) * 220,
          y: m.position_y ?? 80 + Math.floor(i / 4) * 140,
        },
        data: {
          name: persona?.name || 'Agent',
          icon: persona?.icon || '',
          color: persona?.color || '#6366f1',
          role: m.role || 'worker',
          memberId: m.id,
          personaId: m.persona_id,
          edgeCount,
        },
      };
    });

    setNodes(newNodes);
  }, [selectedTeamId, teamMembers, teamConnections, personas, setNodes]);

  // Enrich nodes with pipeline status + optimizer highlights
  useEffect(() => {
    if (pipelineNodeStatuses.length === 0 && !analytics) return;
    setNodes((nds) =>
      nds.map((node) => {
        let updated = { ...node.data };

        // Pipeline status
        const ns = pipelineNodeStatuses.find((s) => s.member_id === node.id);
        if (ns) {
          updated = { ...updated, pipelineStatus: ns.status };
        }

        // Optimizer: mark nodes that have suggestions
        const activeSuggestions = (analytics?.suggestions ?? []).filter(
          (s) => s.affected_member_ids.includes(node.id) && !dismissedSuggestionIds.has(s.id),
        );
        if (activeSuggestions.length > 0) {
          updated = { ...updated, hasOptimizerSuggestion: true, optimizerType: activeSuggestions[0]?.suggestion_type };
        } else {
          updated = { ...updated, hasOptimizerSuggestion: false, optimizerType: undefined };
        }

        return { ...node, data: updated };
      }),
    );
  }, [pipelineNodeStatuses, analytics, dismissedSuggestionIds, setNodes]);

  // Convert teamConnections to React Flow edges + ghost edges from optimizer
  useEffect(() => {
    if (!selectedTeamId) return;

    // Real edges
    const realEdges: Edge[] = teamConnections.map((c) => ({
      id: c.id,
      source: c.source_member_id,
      target: c.target_member_id,
      type: 'connection',
      data: { connection_type: c.connection_type, label: c.label || '' },
    }));

    // Ghost edges from optimizer suggestions
    const ghostEdges: Edge[] = (analytics?.suggestions ?? [])
      .filter(
        (s) =>
          s.suggested_source &&
          s.suggested_target &&
          !dismissedSuggestionIds.has(s.id),
      )
      .filter((s) => {
        // Don't show ghost edge if a real connection already exists between these nodes
        return !teamConnections.some(
          (c) =>
            c.source_member_id === s.suggested_source &&
            c.target_member_id === s.suggested_target,
        );
      })
      .map((s) => ({
        id: `ghost-${s.id}`,
        source: s.suggested_source!,
        target: s.suggested_target!,
        type: 'ghost',
        selectable: false,
        data: {
          connection_type: s.suggested_connection_type || 'parallel',
          suggestion_id: s.id,
        },
      }));

    setEdges([...realEdges, ...ghostEdges]);
  }, [selectedTeamId, teamConnections, analytics, dismissedSuggestionIds, setEdges]);

  // Set isActive on edge data when source is completed and target is running
  useEffect(() => {
    if (pipelineNodeStatuses.length === 0) return;
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.type === 'ghost') return edge; // Don't animate ghost edges
        const sourceStatus = pipelineNodeStatuses.find(
          (s) => s.member_id === edge.source,
        )?.status;
        const targetStatus = pipelineNodeStatuses.find(
          (s) => s.member_id === edge.target,
        )?.status;
        const isActive =
          sourceStatus === 'completed' && targetStatus === 'running';
        return { ...edge, data: { ...edge.data, isActive } };
      }),
    );
  }, [pipelineNodeStatuses, setEdges]);

  // Handle new edge connection -- persist to DB
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target || !selectedTeamId) return;
      try {
        await api.createTeamConnection(selectedTeamId, connection.source, connection.target);
        await fetchTeamDetails(selectedTeamId);
        fetchAnalytics();
      } catch (err) {
        console.error('Failed to create connection:', err);
      }
    },
    [selectedTeamId, fetchTeamDetails, fetchAnalytics],
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
      const posX = 100 + (count % 4) * 220;
      const posY = 80 + Math.floor(count / 4) * 140;
      addTeamMember(personaId, 'worker', posX, posY);
    },
    [teamMembers, addTeamMember],
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
        return [{ ...nds[0]!, position: { x: 200, y: 120 } }];
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
        const x = startX + posInLayer * (nodeWidth + xGap);
        const y = 80 + layerIdx * (nodeHeight + yGap);
        return { ...node, position: { x, y } };
      });
    });
  }, [setNodes, teamConnections]);

  // Handle role change from config panel -- persist to DB
  const handleRoleChange = useCallback(
    async (memberId: string, newRole: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === memberId ? { ...n, data: { ...n.data, role: newRole } } : n,
        ),
      );
      setSelectedMember((prev) => (prev?.id === memberId ? { ...prev, role: newRole } : prev));
      try {
        await api.updateTeamMember(memberId, newRole);
      } catch (err) {
        console.error('Failed to update member role:', err);
      }
    },
    [setNodes],
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

  // Handle confirmed edge deletion
  const handleDeleteEdge = useCallback(async () => {
    if (!edgeTooltip || !selectedTeamId) return;
    try {
      await api.deleteTeamConnection(edgeTooltip.edge.id);
      await fetchTeamDetails(selectedTeamId);
      fetchAnalytics();
    } catch (err) {
      console.error('Failed to delete connection:', err);
    }
    setEdgeTooltip(null);
  }, [edgeTooltip, selectedTeamId, fetchTeamDetails, fetchAnalytics]);

  // Handle connection type change from edge tooltip
  const handleChangeConnectionType = useCallback(
    async (newType: string) => {
      if (!edgeTooltip || !selectedTeamId) return;
      try {
        await api.updateTeamConnection(edgeTooltip.edge.id, newType);
        await fetchTeamDetails(selectedTeamId);
      } catch (err) {
        console.error('Failed to update connection type:', err);
      }
      setEdgeTooltip(null);
    },
    [edgeTooltip, selectedTeamId, fetchTeamDetails],
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

  // Accept an optimizer suggestion — create the suggested connection
  const handleAcceptSuggestion = useCallback(
    async (suggestion: TopologySuggestion) => {
      if (!selectedTeamId) return;

      if (suggestion.suggested_source && suggestion.suggested_target) {
        try {
          await api.createTeamConnection(
            selectedTeamId,
            suggestion.suggested_source,
            suggestion.suggested_target,
            suggestion.suggested_connection_type ?? undefined,
          );
          await fetchTeamDetails(selectedTeamId);
          setDismissedSuggestionIds((prev) => new Set([...prev, suggestion.id]));
          fetchAnalytics();
        } catch (err) {
          console.error('Failed to accept suggestion:', err);
        }
      } else {
        // For non-connection suggestions (remove, reorder), just dismiss
        setDismissedSuggestionIds((prev) => new Set([...prev, suggestion.id]));
      }
    },
    [selectedTeamId, fetchTeamDetails, fetchAnalytics],
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

  // Canvas Assistant: apply a blueprint — add members, connections, and positions
  const handleAssistantApply = useCallback(
    async (blueprint: import('@/lib/bindings/TopologyBlueprint').TopologyBlueprint) => {
      if (!selectedTeamId) return;
      setAssistantApplying(true);
      try {
        // Add members sequentially (need member IDs back for connections)
        const newMemberIds: string[] = [];
        for (const m of blueprint.members) {
          const member = await api.addTeamMember(
            selectedTeamId,
            m.persona_id,
            m.role,
            m.position_x,
            m.position_y,
          );
          newMemberIds.push(member.id);
        }

        // Create connections using the new member IDs
        for (const c of blueprint.connections) {
          const sourceId = newMemberIds[c.source_index];
          const targetId = newMemberIds[c.target_index];
          if (sourceId && targetId) {
            await api.createTeamConnection(
              selectedTeamId,
              sourceId,
              targetId,
              c.connection_type,
            );
          }
        }

        // Refresh team data
        await fetchTeamDetails(selectedTeamId);
        fetchAnalytics();
      } catch (err) {
        console.error('Failed to apply blueprint:', err);
      } finally {
        setAssistantApplying(false);
      }
    },
    [selectedTeamId, fetchTeamDetails, fetchAnalytics],
  );

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

      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={() => { setContextMenu(null); setEdgeTooltip(null); }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
        </ReactFlow>

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

        <PipelineControls
          teamId={selectedTeamId}
          isRunning={pipelineRunning}
          nodeStatuses={pipelineNodeStatuses}
          onExecute={handleExecuteTeam}
          agentNames={agentNames}
        />

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
              <p className="text-sm text-muted-foreground/80">Click &quot;Add Agent&quot; above to get started</p>
            </div>
          </div>
        )}
      </div>
    </ContentBox>
  );
}
