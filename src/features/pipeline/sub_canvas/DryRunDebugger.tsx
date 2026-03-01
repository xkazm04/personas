import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipForward,
  Square,
  CircleDot,
  ChevronDown,
  ChevronUp,
  X,
  Bug,
} from 'lucide-react';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';

// ============================================================================
// Types
// ============================================================================

export interface DryRunNodeData {
  memberId: string;
  status: 'idle' | 'queued' | 'running' | 'completed' | 'paused';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
}

export interface DryRunState {
  active: boolean;
  breakpoints: Set<string>;
  nodeData: Map<string, DryRunNodeData>;
  currentNodeId: string | null;
  completedEdges: Set<string>; // "sourceId->targetId"
  activeEdge: string | null;   // "sourceId->targetId"
  executionOrder: string[];
  stepIndex: number;
  paused: boolean;
}

interface DryRunDebuggerProps {
  members: PersonaTeamMember[];
  connections: PersonaTeamConnection[];
  agentNames: Record<string, string>;
  agentRoles: Record<string, string>;
  onStateChange: (state: DryRunState) => void;
  onClose: () => void;
}

// ============================================================================
// Mock Data Generator
// ============================================================================

function generateMockInput(
  role: string,
  name: string,
  upstreamOutputs: Record<string, unknown>[],
): Record<string, unknown> {
  if (upstreamOutputs.length > 0) {
    return {
      upstream_results: upstreamOutputs,
      timestamp: new Date().toISOString(),
    };
  }

  switch (role) {
    case 'orchestrator':
      return { task: `Coordinate pipeline execution`, agents_available: 3, priority: 'normal' };
    case 'router':
      return { incoming_request: `Route this task to the appropriate handler`, metadata: { source: 'user', type: 'query' } };
    case 'reviewer':
      return { content_to_review: `[Output from upstream agent]`, criteria: ['accuracy', 'completeness', 'tone'] };
    default:
      return { instruction: `Process task for ${name}`, context: 'Pipeline dry-run simulation' };
  }
}

function generateMockOutput(role: string, name: string): Record<string, unknown> {
  switch (role) {
    case 'orchestrator':
      return {
        delegations: [
          { agent: 'worker-1', task: 'Execute primary task' },
          { agent: 'worker-2', task: 'Execute secondary task' },
        ],
        strategy: 'parallel',
        estimated_steps: 3,
      };
    case 'reviewer':
      return {
        approved: true,
        score: 8.5,
        feedback: `Output meets quality criteria. Minor suggestions for improvement.`,
        issues: [],
      };
    case 'router':
      return {
        selected_route: 'specialist-a',
        confidence: 0.92,
        reason: `Request matches specialist-a's domain based on keyword analysis`,
        alternatives: ['specialist-b'],
      };
    default:
      return {
        result: `[Simulated output from ${name}]`,
        confidence: 0.89,
        tokens_used: Math.floor(Math.random() * 2000) + 500,
        latency_ms: Math.floor(Math.random() * 3000) + 200,
      };
  }
}

// ============================================================================
// Topological Sort
// ============================================================================

function topologicalSort(
  members: PersonaTeamMember[],
  connections: PersonaTeamConnection[],
): string[] {
  const memberIds = members.map((m) => m.id);
  const idSet = new Set(memberIds);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of memberIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const c of connections) {
    if (!idSet.has(c.source_member_id) || !idSet.has(c.target_member_id)) continue;
    // Skip feedback edges for ordering (they create cycles)
    if (c.connection_type === 'feedback') continue;
    adj.get(c.source_member_id)!.push(c.target_member_id);
    inDegree.set(c.target_member_id, (inDegree.get(c.target_member_id) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adj.get(node) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Add any remaining nodes (cycles)
  for (const id of memberIds) {
    if (!sorted.includes(id)) sorted.push(id);
  }

  return sorted;
}

// ============================================================================
// Component
// ============================================================================

const STEP_DELAY = 800;

export default function DryRunDebugger({
  members,
  connections,
  agentNames,
  agentRoles,
  onStateChange,
  onClose,
}: DryRunDebuggerProps) {
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [executionOrder, setExecutionOrder] = useState<string[]>([]);
  const [stepIndex, setStepIndex] = useState(-1);
  const [nodeData, setNodeData] = useState<Map<string, DryRunNodeData>>(new Map());
  const [paused, setPaused] = useState(true);
  const [completedEdges, setCompletedEdges] = useState<Set<string>>(new Set());
  const [activeEdge, setActiveEdge] = useState<string | null>(null);
  const [inspectedNode, setInspectedNode] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const autoStepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const currentNodeId = stepIndex >= 0 && stepIndex < executionOrder.length
    ? executionOrder[stepIndex] ?? null
    : null;

  // Initialize execution order and node data
  useEffect(() => {
    const order = topologicalSort(members, connections);
    setExecutionOrder(order);

    const initial = new Map<string, DryRunNodeData>();
    for (const id of order) {
      initial.set(id, { memberId: id, status: 'idle', input: null, output: null });
    }
    setNodeData(initial);
    setStepIndex(-1);
    setPaused(true);
    setCompletedEdges(new Set());
    setActiveEdge(null);
  }, [members, connections]);

  // Propagate state to parent
  useEffect(() => {
    onStateChange({
      active: true,
      breakpoints,
      nodeData,
      currentNodeId,
      completedEdges,
      activeEdge,
      executionOrder,
      stepIndex,
      paused,
    });
  }, [breakpoints, nodeData, currentNodeId, completedEdges, activeEdge, executionOrder, stepIndex, paused, onStateChange]);

  // Get upstream outputs for a node
  const getUpstreamOutputs = useCallback(
    (memberId: string, data: Map<string, DryRunNodeData>): Record<string, unknown>[] => {
      const upstream: Record<string, unknown>[] = [];
      for (const c of connections) {
        if (c.target_member_id === memberId && c.connection_type !== 'feedback') {
          const sourceData = data.get(c.source_member_id);
          if (sourceData?.output) upstream.push(sourceData.output);
        }
      }
      return upstream;
    },
    [connections],
  );

  // Execute one step
  const executeStep = useCallback(() => {
    setStepIndex((prev) => {
      const nextIdx = prev + 1;
      if (nextIdx >= executionOrder.length) return prev;

      const nodeId = executionOrder[nextIdx]!;
      const role = agentRoles[nodeId] || 'worker';
      const name = agentNames[nodeId] || 'Agent';

      setNodeData((prevData) => {
        const updated = new Map(prevData);

        // Mark previous node as completed
        if (prev >= 0 && prev < executionOrder.length) {
          const prevId = executionOrder[prev]!;
          const prevNode = updated.get(prevId);
          if (prevNode) {
            updated.set(prevId, { ...prevNode, status: 'completed' });
          }

          // Mark edges from previous node as completed
          for (const c of connections) {
            if (c.source_member_id === prevId && c.connection_type !== 'feedback') {
              setCompletedEdges((s) => new Set([...s, `${c.source_member_id}->${c.target_member_id}`]));
            }
          }
        }

        // Generate input/output for current node
        const upstreamOutputs = getUpstreamOutputs(nodeId, updated);
        const input = generateMockInput(role, name, upstreamOutputs);
        const output = generateMockOutput(role, name);

        updated.set(nodeId, { memberId: nodeId, status: 'running', input, output });

        // Set active edge
        const incomingEdge = connections.find(
          (c) => c.target_member_id === nodeId && c.connection_type !== 'feedback',
        );
        if (incomingEdge) {
          setActiveEdge(`${incomingEdge.source_member_id}->${incomingEdge.target_member_id}`);
        } else {
          setActiveEdge(null);
        }

        // Mark remaining nodes as queued
        for (let i = nextIdx + 1; i < executionOrder.length; i++) {
          const futureId = executionOrder[i]!;
          const futureNode = updated.get(futureId);
          if (futureNode && futureNode.status === 'idle') {
            updated.set(futureId, { ...futureNode, status: 'queued' });
          }
        }

        return updated;
      });

      // Check if next node has a breakpoint
      if (breakpoints.has(nodeId)) {
        setPaused(true);
      }

      setInspectedNode(nodeId);
      return nextIdx;
    });
  }, [executionOrder, agentRoles, agentNames, connections, breakpoints, getUpstreamOutputs]);

  // Finalize: mark last node as completed
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
      // Mark remaining edges
      for (const c of connections) {
        if (c.source_member_id === lastId && c.connection_type !== 'feedback') {
          setCompletedEdges((s) => new Set([...s, `${c.source_member_id}->${c.target_member_id}`]));
        }
      }
    }
  }, [stepIndex, executionOrder, connections]);

  // Auto-step when not paused
  useEffect(() => {
    if (paused || stepIndex >= executionOrder.length - 1) {
      if (autoStepRef.current) clearTimeout(autoStepRef.current);
      // Finalize when done
      if (stepIndex >= executionOrder.length - 1 && stepIndex >= 0) {
        finalize();
      }
      return;
    }
    autoStepRef.current = setTimeout(() => {
      if (!pausedRef.current) executeStep();
    }, STEP_DELAY);
    return () => {
      if (autoStepRef.current) clearTimeout(autoStepRef.current);
    };
  }, [paused, stepIndex, executionOrder.length, executeStep, finalize]);

  // Toggle breakpoint
  const toggleBreakpoint = useCallback((memberId: string) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }, []);

  // Controls
  const handlePlay = () => {
    if (stepIndex < 0) executeStep();
    setPaused(false);
  };

  const handlePause = () => setPaused(true);

  const handleStepForward = () => {
    setPaused(true);
    if (stepIndex >= executionOrder.length - 1) {
      finalize();
      return;
    }
    executeStep();
  };

  const handleStop = () => {
    if (autoStepRef.current) clearTimeout(autoStepRef.current);
    onClose();
  };

  const isFinished = stepIndex >= executionOrder.length - 1 && stepIndex >= 0;
  const isStarted = stepIndex >= 0;

  // Inspected node data
  const inspectedData = inspectedNode ? nodeData.get(inspectedNode) : null;

  // Build ordered list for execution timeline
  const timeline = useMemo(
    () =>
      executionOrder.map((id) => ({
        id,
        name: agentNames[id] || 'Agent',
        role: agentRoles[id] || 'worker',
        data: nodeData.get(id),
        hasBreakpoint: breakpoints.has(id),
      })),
    [executionOrder, agentNames, agentRoles, nodeData, breakpoints],
  );

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30">
      {/* Data Inspector Panel */}
      <AnimatePresence>
        {inspectedData && !panelCollapsed && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="mx-4 mb-2 rounded-xl bg-secondary/90 backdrop-blur-md border border-primary/15 shadow-2xl overflow-hidden max-h-[280px]"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
              <div className="flex items-center gap-2">
                <Bug className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-sm font-semibold text-foreground/90">
                  {agentNames[inspectedData.memberId] || 'Agent'}
                </span>
                <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded-md ${
                  inspectedData.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
                  inspectedData.status === 'running' ? 'bg-blue-500/15 text-blue-400' :
                  'bg-zinc-500/15 text-muted-foreground'
                }`}>
                  {inspectedData.status}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPanelCollapsed(true)}
                  className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground/80 hover:text-foreground/80 transition-colors"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setInspectedNode(null)}
                  className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground/80 hover:text-foreground/80 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-0 divide-x divide-primary/10 overflow-y-auto max-h-[230px]">
              {/* Input */}
              <div className="p-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5">Input</div>
                {inspectedData.input ? (
                  <pre className="text-[11px] text-foreground/80 font-mono leading-relaxed whitespace-pre-wrap break-all">
                    {JSON.stringify(inspectedData.input, null, 2)}
                  </pre>
                ) : (
                  <span className="text-[11px] text-muted-foreground/50 italic">No input data</span>
                )}
              </div>
              {/* Output */}
              <div className="p-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5">Output</div>
                {inspectedData.output ? (
                  <pre className="text-[11px] text-foreground/80 font-mono leading-relaxed whitespace-pre-wrap break-all">
                    {JSON.stringify(inspectedData.output, null, 2)}
                  </pre>
                ) : (
                  <span className="text-[11px] text-muted-foreground/50 italic">Awaiting execution</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Debugger Controls Bar */}
      <div className="bg-zinc-900/95 backdrop-blur-md border-t border-amber-500/20 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Debug badge */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/25">
            <Bug className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">Dry Run</span>
          </div>

          {/* Transport controls */}
          <div className="flex items-center gap-1">
            {!isFinished && !paused ? (
              <button
                onClick={handlePause}
                className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-300 hover:bg-amber-500/25 transition-colors"
                title="Pause"
              >
                <Pause className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handlePlay}
                disabled={isFinished}
                className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title={isStarted ? 'Continue' : 'Start'}
              >
                <Play className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={handleStepForward}
              disabled={isFinished}
              className="p-1.5 rounded-lg bg-blue-500/15 border border-blue-500/25 text-blue-300 hover:bg-blue-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Step Forward"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              onClick={handleStop}
              className="p-1.5 rounded-lg bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors"
              title="Stop Dry Run"
            >
              <Square className="w-4 h-4" />
            </button>
          </div>

          {/* Step progress */}
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground/80">
            <span>Step {Math.max(0, stepIndex + 1)} / {executionOrder.length}</span>
            {isFinished && <span className="text-emerald-400">Complete</span>}
            {paused && isStarted && !isFinished && <span className="text-amber-400">Paused</span>}
          </div>

          {/* Execution timeline dots */}
          <div className="flex items-center gap-1 ml-2">
            {timeline.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  toggleBreakpoint(item.id);
                }}
                onDoubleClick={() => {
                  if (item.data?.input || item.data?.output) {
                    setInspectedNode(item.id);
                    setPanelCollapsed(false);
                  }
                }}
                className="relative group/dot"
                title={`${item.name} (${item.role})${item.hasBreakpoint ? ' [BREAKPOINT]' : ''}`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                    item.data?.status === 'completed'
                      ? 'bg-emerald-500 border-emerald-400'
                      : item.data?.status === 'running'
                        ? 'bg-blue-500 border-blue-400 animate-pulse'
                        : item.data?.status === 'paused'
                          ? 'bg-amber-500 border-amber-400'
                          : item.data?.status === 'queued'
                            ? 'bg-zinc-600 border-zinc-500'
                            : 'bg-zinc-700 border-zinc-600'
                  }`}
                />
                {item.hasBreakpoint && (
                  <CircleDot className="absolute -top-1 -right-1 w-2.5 h-2.5 text-red-400" />
                )}
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-[10px] font-mono rounded bg-background border border-primary/20 text-foreground/80 whitespace-nowrap shadow-lg opacity-0 group-hover/dot:opacity-100 pointer-events-none transition-opacity z-50">
                  {item.name}
                </div>
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Collapse toggle for inspector */}
          {inspectedNode && panelCollapsed && (
            <button
              onClick={() => setPanelCollapsed(false)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/5 border border-primary/10 text-muted-foreground/80 hover:text-foreground/80 transition-colors text-[11px]"
            >
              <ChevronUp className="w-3 h-3" />
              Inspector
            </button>
          )}

          {/* Breakpoint count */}
          {breakpoints.size > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-red-400/80">
              <CircleDot className="w-3 h-3" />
              {breakpoints.size} breakpoint{breakpoints.size !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
