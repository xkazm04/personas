import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Connection, Edge, Node, NodeChange } from '@xyflow/react';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useAgentStore } from "@/stores/agentStore";
import { updateTeamMember } from "@/api/pipeline/teams";
import { computeAlignments } from '@/features/pipeline/sub_canvas';
import { computeAutoLayout } from './canvasAutoLayout';
import type { StickyNoteCategory } from '@/features/pipeline/sub_canvas';
import type { useCanvasReducer } from '@/features/pipeline/sub_canvas';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';

export const GRID_SIZE = 24;
export function snapToGrid(v: number) {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

type CanvasReducerReturn = ReturnType<typeof useCanvasReducer>;

export interface UseCanvasHandlersArgs {
  cs: CanvasReducerReturn['state'];
  dispatch: CanvasReducerReturn['dispatch'];
  setSaveStatus: CanvasReducerReturn['setSaveStatus'];
  setSelectedMember: CanvasReducerReturn['setSelectedMember'];
  setContextMenu: CanvasReducerReturn['setContextMenu'];
  setEdgeTooltip: CanvasReducerReturn['setEdgeTooltip'];
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  onNodesChangeBase: (changes: NodeChange<Node>[]) => void;
  fetchAnalytics: () => Promise<void>;
}

export function useCanvasHandlers({
  cs, dispatch, setSaveStatus, setSelectedMember, setContextMenu,
  setEdgeTooltip, nodes, setNodes, onNodesChangeBase,
  fetchAnalytics,
}: UseCanvasHandlersArgs) {
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const selectedTeamId = usePipelineStore((s) => s.selectedTeamId);
  const teams = usePipelineStore((s) => s.teams);
  const teamMembers = usePipelineStore((s) => s.teamMembers) as PersonaTeamMember[];
  const teamConnections = usePipelineStore((s) => s.teamConnections) as PersonaTeamConnection[];
  const addTeamMember = usePipelineStore((s) => s.addTeamMember);
  const removeTeamMember = usePipelineStore((s) => s.removeTeamMember);
  const createTeamConnection = usePipelineStore((s) => s.createTeamConnection);
  const deleteTeamConnection = usePipelineStore((s) => s.deleteTeamConnection);
  const updateTeamConnection = usePipelineStore((s) => s.updateTeamConnection);
  const personas = useAgentStore((s) => s.personas);
  const selectTeam = usePipelineStore((s) => s.selectTeam);

  const selectedTeam = useMemo(() => teams.find((t: PersonaTeam) => t.id === selectedTeamId), [teams, selectedTeamId]);
  const agentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of teamMembers) { map[m.id] = personas.find((p) => p.id === m.persona_id)?.name || 'Agent'; }
    return map;
  }, [teamMembers, personas]);
  const agentRoles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of teamMembers) { map[m.id] = m.role || 'worker'; }
    return map;
  }, [teamMembers]);

  const handleAddNote = useCallback(() => {
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const count = cs.stickyNotes.length;
    dispatch({ type: 'ADD_STICKY_NOTE', note: { id, x: snapToGrid(300 + (count % 3) * 200), y: snapToGrid(60 + Math.floor(count / 3) * 160), text: '', category: 'documentation' } });
  }, [cs.stickyNotes.length, dispatch]);

  const handleUpdateNote = useCallback((id: string, text: string, category: StickyNoteCategory) => {
    dispatch({ type: 'UPDATE_STICKY_NOTE', id, text, category });
  }, [dispatch]);

  const handleDeleteNote = useCallback((id: string) => {
    dispatch({ type: 'DELETE_STICKY_NOTE', id });
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, [dispatch, setNodes]);

  const isValidConnection = useCallback((connection: Edge | Connection) => connection.source !== connection.target, []);

  const onConnect = useCallback(async (connection: Connection) => {
    if (!connection.source || !connection.target || !selectedTeamId) return;
    if (connection.source === connection.target) return;
    if (teamConnections.some((c) => c.source_member_id === connection.source && c.target_member_id === connection.target)) return;
    await createTeamConnection(connection.source, connection.target);
    fetchAnalytics();
  }, [selectedTeamId, createTeamConnection, fetchAnalytics, teamConnections]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    const member = teamMembers.find((m) => m.id === node.id);
    if (member) {
      const persona = personas.find((p) => p.id === member.persona_id);
      setSelectedMember({ ...member, persona_name: persona?.name, persona_icon: persona?.icon ?? undefined, persona_color: persona?.color ?? undefined });
    }
  }, [teamMembers, personas, setSelectedMember]);

  const handleAddMember = useCallback((personaId: string) => {
    const count = teamMembers.length;
    addTeamMember(personaId, 'worker', snapToGrid(100 + (count % 4) * 220), snapToGrid(80 + Math.floor(count / 4) * 140));
  }, [teamMembers, addTeamMember]);

  const handleSave = useCallback(async () => {
    if (!selectedTeamId) return;
    setSaveStatus('saving');
    try {
      await Promise.all(nodes.filter((n) => n.type !== 'stickyNote').map((n) => updateTeamMember(n.id, undefined, n.position.x, n.position.y)));
      setSaveStatus('saved');
    } catch (err) { console.error('Failed to save canvas:', err); setSaveStatus('unsaved'); }
  }, [selectedTeamId, nodes, setSaveStatus]);

  saveRef.current = handleSave;
  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    onNodesChangeBase(changes);
    const hasPositionChange = changes.some((c) => c.type === 'position' && !c.dragging);
    if (hasPositionChange) {
      for (const c of changes) {
        if (c.type === 'position' && !c.dragging && c.position && c.id.startsWith('note-'))
          dispatch({ type: 'UPDATE_STICKY_NOTE_POSITION', id: c.id, x: c.position.x, y: c.position.y });
      }
      setSaveStatus('unsaved');
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => { saveRef.current(); }, 1500);
    }
  }, [onNodesChangeBase, dispatch, setSaveStatus]);

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node) => {
    dispatch({ type: 'SET_IS_DRAGGING_NODE', dragging: true });
    dispatch({ type: 'SET_ALIGNMENT_LINES', lines: computeAlignments(node, nodes) });
  }, [nodes, dispatch]);

  const onNodeDragStop = useCallback(() => { dispatch({ type: 'SET_IS_DRAGGING_NODE', dragging: false }); }, [dispatch]);
  useEffect(() => { return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); }; }, []);

  const handleAutoLayout = useCallback(() => {
    setSaveStatus('unsaved');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { saveRef.current(); }, 1500);
    setNodes((nds) => computeAutoLayout(nds, teamConnections));
  }, [setNodes, teamConnections, setSaveStatus]);

  const handleRoleChange = useCallback(async (memberId: string, newRole: string) => {
    dispatch({ type: 'UPDATE_SELECTED_MEMBER_ROLE', memberId, role: newRole });
    try { await updateTeamMember(memberId, newRole); }
    catch (err) { console.error('Failed to update member role:', err); }
  }, [dispatch]);

  const handleRemoveMember = useCallback((memberId: string) => { removeTeamMember(memberId); setSelectedMember(null); }, [removeTeamMember, setSelectedMember]);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (edge.type === 'ghost') return;
    setEdgeTooltip({ x: event.clientX, y: event.clientY, edge });
  }, [setEdgeTooltip]);

  const handleDeleteEdge = useCallback(async () => {
    if (!cs.edgeTooltip || !selectedTeamId) return;
    await deleteTeamConnection(cs.edgeTooltip.edge.id);
    fetchAnalytics();
    setEdgeTooltip(null);
  }, [cs.edgeTooltip, selectedTeamId, deleteTeamConnection, fetchAnalytics, setEdgeTooltip]);

  const handleChangeConnectionType = useCallback(async (newType: string) => {
    if (!cs.edgeTooltip || !selectedTeamId) return;
    await updateTeamConnection(cs.edgeTooltip.edge.id, newType);
    setEdgeTooltip(null);
  }, [cs.edgeTooltip, selectedTeamId, updateTeamConnection, setEdgeTooltip]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const member = teamMembers.find((m) => m.id === node.id);
    if (member) {
      const persona = personas.find((p) => p.id === member.persona_id);
      setContextMenu({ x: event.clientX, y: event.clientY, member: { ...member, persona_name: persona?.name, persona_icon: persona?.icon ?? undefined, persona_color: persona?.color ?? undefined } });
    }
  }, [teamMembers, personas, setContextMenu]);

  const handleBack = useCallback(() => {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    if (cs.saveStatus === 'unsaved') { handleSave().then(() => selectTeam(null)); } else { selectTeam(null); }
  }, [cs.saveStatus, handleSave, selectTeam]);

  return {
    selectedTeam, teamMembers, teamConnections, personas, agentNames, agentRoles,
    handleAddNote, handleUpdateNote, handleDeleteNote,
    isValidConnection, onConnect, onNodeClick, handleAddMember,
    handleSave, onNodesChange, onNodeDrag, onNodeDragStop, handleAutoLayout,
    handleRoleChange, handleRemoveMember, onEdgeClick, handleDeleteEdge,
    handleChangeConnectionType, onNodeContextMenu, handleBack,
  };
}
