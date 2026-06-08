import { useState, useCallback, useEffect, useRef } from 'react';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import { buildTeamGraph } from './teamGraph';
import { generateMockInput, generateMockOutput } from './debuggerMocks';
import type { DryRunNodeData, DryRunState, UseDebuggerReturn } from './debuggerTypes';

export type { DryRunNodeData, DryRunState, UseDebuggerReturn } from './debuggerTypes';

const SKIP_FEEDBACK = new Set(['feedback']);
const STEP_DELAY = 800;

export function useDebugger(
  members: PersonaTeamMember[],
  connections: PersonaTeamConnection[],
  agentNames: Record<string, string>,
  agentRoles: Record<string, string>,
  onStateChange: (state: DryRunState) => void,
  onClose: () => void,
): UseDebuggerReturn {
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [executionOrder, setExecutionOrder] = useState<string[]>([]);
  const [stepIndex, setStepIndex] = useState(-1);
  const [nodeData, setNodeData] = useState<Map<string, DryRunNodeData>>(new Map());
  const [paused, setPaused] = useState(true);
  const [completedEdges, setCompletedEdges] = useState<Set<string>>(new Set());
  const [activeEdge, setActiveEdge] = useState<string | null>(null);
  const [inspectedNode, setInspectedNode] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [cycleNodeIds, setCycleNodeIds] = useState<Set<string>>(new Set());
  const autoStepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const currentNodeId = stepIndex >= 0 && stepIndex < executionOrder.length
    ? executionOrder[stepIndex] ?? null : null;

  useEffect(() => {
    const graph = buildTeamGraph(members.map((m) => m.id), connections, SKIP_FEEDBACK);
    setExecutionOrder(graph.sorted);
    setCycleNodeIds(graph.cycleNodes);
    const initial = new Map<string, DryRunNodeData>();
    for (const id of graph.sorted) initial.set(id, { memberId: id, status: 'idle', input: null, output: null });
    setNodeData(initial);
    setStepIndex(-1);
    setPaused(true);
    setCompletedEdges(new Set());
    setActiveEdge(null);
  }, [members, connections]);

  useEffect(() => {
    onStateChange({ active: true, breakpoints, nodeData, currentNodeId, completedEdges, activeEdge, executionOrder, stepIndex, paused });
  }, [breakpoints, nodeData, currentNodeId, completedEdges, activeEdge, executionOrder, stepIndex, paused, onStateChange]);

  const getUpstreamOutputs = useCallback(
    (memberId: string, data: Map<string, DryRunNodeData>): Record<string, unknown>[] => {
      const upstream: Record<string, unknown>[] = [];
      for (const c of connections) {
        if (c.target_member_id === memberId && c.connection_type !== 'feedback') {
          const src = data.get(c.source_member_id);
          if (src?.output) upstream.push(src.output);
        }
      }
      return upstream;
    }, [connections]);

  const executeStep = useCallback(() => {
    setStepIndex((prev) => {
      const nextIdx = prev + 1;
      if (nextIdx >= executionOrder.length) return prev;
      const nodeId = executionOrder[nextIdx]!;
      const role = agentRoles[nodeId] || 'worker';
      const name = agentNames[nodeId] || 'Agent';

      setNodeData((prevData) => {
        const updated = new Map(prevData);
        if (prev >= 0 && prev < executionOrder.length) {
          const prevId = executionOrder[prev]!;
          const prevNode = updated.get(prevId);
          if (prevNode) updated.set(prevId, { ...prevNode, status: 'completed' });
          for (const c of connections) {
            if (c.source_member_id === prevId && c.connection_type !== 'feedback')
              setCompletedEdges((s) => new Set([...s, `${c.source_member_id}->${c.target_member_id}`]));
          }
        }
        const upOuts = getUpstreamOutputs(nodeId, updated);
        updated.set(nodeId, { memberId: nodeId, status: 'running', input: generateMockInput(role, name, upOuts), output: generateMockOutput(role, name) });
        const inc = connections.find((c) => c.target_member_id === nodeId && c.connection_type !== 'feedback');
        setActiveEdge(inc ? `${inc.source_member_id}->${inc.target_member_id}` : null);
        for (let i = nextIdx + 1; i < executionOrder.length; i++) {
          const fId = executionOrder[i]!;
          const fn = updated.get(fId);
          if (fn && fn.status === 'idle') updated.set(fId, { ...fn, status: 'queued' });
        }
        return updated;
      });
      if (breakpoints.has(nodeId)) setPaused(true);
      setInspectedNode(nodeId);
      return nextIdx;
    });
  }, [executionOrder, agentRoles, agentNames, connections, breakpoints, getUpstreamOutputs]);

  const finalize = useCallback(() => {
    if (stepIndex >= 0 && stepIndex < executionOrder.length) {
      const lastId = executionOrder[stepIndex]!;
      setNodeData((prev) => {
        const updated = new Map(prev);
        const node = updated.get(lastId);
        if (node) updated.set(lastId, { ...node, status: 'completed' });
        return updated;
      });
      setActiveEdge(null);
      for (const c of connections) {
        if (c.source_member_id === lastId && c.connection_type !== 'feedback')
          setCompletedEdges((s) => new Set([...s, `${c.source_member_id}->${c.target_member_id}`]));
      }
    }
  }, [stepIndex, executionOrder, connections]);

  useEffect(() => {
    if (paused || stepIndex >= executionOrder.length - 1) {
      if (autoStepRef.current) clearTimeout(autoStepRef.current);
      if (stepIndex >= executionOrder.length - 1 && stepIndex >= 0) finalize();
      return;
    }
    autoStepRef.current = setTimeout(() => { if (!pausedRef.current) executeStep(); }, STEP_DELAY);
    return () => { if (autoStepRef.current) clearTimeout(autoStepRef.current); };
  }, [paused, stepIndex, executionOrder.length, executeStep, finalize]);

  const toggleBreakpoint = useCallback((memberId: string) => {
    setBreakpoints((prev) => { const next = new Set(prev); if (next.has(memberId)) next.delete(memberId); else next.add(memberId); return next; });
  }, []);

  const handlePlay = () => { if (stepIndex < 0) executeStep(); setPaused(false); };
  const handlePause = () => setPaused(true);
  const handleStepForward = () => { setPaused(true); if (stepIndex >= executionOrder.length - 1) { finalize(); return; } executeStep(); };
  const handleStop = () => { if (autoStepRef.current) clearTimeout(autoStepRef.current); onClose(); };

  const isFinished = stepIndex >= executionOrder.length - 1 && stepIndex >= 0;
  const isStarted = stepIndex >= 0;
  const inspectedData = inspectedNode ? nodeData.get(inspectedNode) ?? null : null;
  const timeline = executionOrder.map((id) => ({
    id, name: agentNames[id] || 'Agent', role: agentRoles[id] || 'worker',
    data: nodeData.get(id), hasBreakpoint: breakpoints.has(id),
  }));

  return {
    breakpoints, executionOrder, stepIndex, nodeData, paused,
    completedEdges, activeEdge, inspectedNode, panelCollapsed,
    cycleNodeIds, currentNodeId, isFinished, isStarted, inspectedData, timeline,
    toggleBreakpoint, handlePlay, handlePause, handleStepForward, handleStop,
    setInspectedNode, setPanelCollapsed,
  };
}
