import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Users } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';
import * as api from '@/api/tauriApi';
import TeamList from './team/TeamList';
import PersonaNode from './team/PersonaNode';
import ConnectionEdge from './team/ConnectionEdge';
import TeamToolbar from './team/TeamToolbar';
import TeamConfigPanel from './team/TeamConfigPanel';
import NodeContextMenu from './team/NodeContextMenu';
import PipelineControls from './team/PipelineControls';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';

const nodeTypes = { persona: PersonaNode };
const edgeTypes = { connection: ConnectionEdge };

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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedMember, setSelectedMember] = useState<MemberWithPersonaInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; member: MemberWithPersonaInfo } | null>(null);

  // Pipeline state
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineNodeStatuses, setPipelineNodeStatuses] = useState<PipelineNodeStatus[]>([]);

  const selectedTeam = useMemo(
    () => teams.find((t: PersonaTeam) => t.id === selectedTeamId),
    [teams, selectedTeamId],
  );

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
        setPipelineRunning(event.payload.status === 'running');
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [selectedTeamId]);

  // Convert teamMembers to React Flow nodes
  useEffect(() => {
    if (!selectedTeamId) return;

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
        },
      };
    });

    setNodes(newNodes);
  }, [selectedTeamId, teamMembers, personas, setNodes]);

  // Enrich nodes with pipeline status
  useEffect(() => {
    if (pipelineNodeStatuses.length === 0) return;
    setNodes((nds) =>
      nds.map((node) => {
        const ns = pipelineNodeStatuses.find((s) => s.member_id === node.id);
        if (ns) {
          return { ...node, data: { ...node.data, pipelineStatus: ns.status } };
        }
        return node;
      }),
    );
  }, [pipelineNodeStatuses, setNodes]);

  // Convert teamConnections to React Flow edges
  useEffect(() => {
    if (!selectedTeamId) return;
    const newEdges: Edge[] = teamConnections.map((c) => ({
      id: c.id,
      source: c.source_member_id,
      target: c.target_member_id,
      type: 'connection',
      data: { connection_type: c.connection_type, label: c.label || '' },
    }));
    setEdges(newEdges);
  }, [selectedTeamId, teamConnections, setEdges]);

  // Set isActive on edge data when source is completed and target is running
  useEffect(() => {
    if (pipelineNodeStatuses.length === 0) return;
    setEdges((eds) =>
      eds.map((edge) => {
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
      } catch (err) {
        console.error('Failed to create connection:', err);
      }
    },
    [selectedTeamId, fetchTeamDetails],
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

  // Auto layout: left-to-right grid arrangement
  const handleAutoLayout = useCallback(() => {
    setNodes((nds) =>
      nds.map((node, i) => ({
        ...node,
        position: {
          x: 100 + (i % 4) * 220,
          y: 80 + Math.floor(i / 4) * 140,
        },
      })),
    );
  }, [setNodes]);

  // Save canvas data (node positions) to backend -- persists positions to member records
  const handleSave = useCallback(async () => {
    if (!selectedTeamId) return;
    try {
      await Promise.all(
        nodes.map((n) =>
          api.updateTeamMember(n.id, undefined, n.position.x, n.position.y),
        ),
      );
    } catch (err) {
      console.error('Failed to save canvas:', err);
    }
  }, [selectedTeamId, nodes]);

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

  // Handle edge click to delete connection from DB
  const onEdgeClick = useCallback(
    async (_event: React.MouseEvent, edge: Edge) => {
      if (!selectedTeamId) return;
      try {
        await api.deleteTeamConnection(edge.id);
        await fetchTeamDetails(selectedTeamId);
      } catch (err) {
        console.error('Failed to delete connection:', err);
      }
    },
    [selectedTeamId, fetchTeamDetails],
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

  // If no team selected, show list
  if (!selectedTeamId) {
    return <TeamList />;
  }

  return (
    <div className="h-full flex flex-col relative">
      <div className="relative z-10">
        <TeamToolbar
          teamName={selectedTeam?.name || 'Team'}
          onBack={() => selectTeam(null)}
          onAutoLayout={handleAutoLayout}
          onSave={handleSave}
          onAddMember={handleAddMember}
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
          onPaneClick={() => setContextMenu(null)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          className="bg-background"
          defaultEdgeOptions={{ type: 'connection' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} className="opacity-30" />
          <Controls className="!bg-secondary/60 !border-primary/15 !rounded-xl !shadow-lg [&>button]:!bg-secondary/80 [&>button]:!border-primary/15 [&>button]:!text-foreground/60 [&>button:hover]:!bg-secondary [&>button:hover]:!text-foreground/90" />
          <MiniMap
            className="!bg-secondary/40 !border-primary/15 !rounded-xl"
            maskColor="rgba(0,0,0,0.3)"
            nodeColor={(n) => (n.data as Record<string, string>)?.color || '#6366f1'}
          />
        </ReactFlow>

        <PipelineControls
          teamId={selectedTeamId}
          isRunning={pipelineRunning}
          nodeStatuses={pipelineNodeStatuses}
          onExecute={handleExecuteTeam}
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

        {/* Empty state */}
        {teamMembers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <Users className="w-8 h-8 text-indigo-400/50" />
              </div>
              <p className="text-sm font-medium text-foreground/60 mb-1">No agents in this team</p>
              <p className="text-xs text-muted-foreground/40">Click &quot;Add Agent&quot; above to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
