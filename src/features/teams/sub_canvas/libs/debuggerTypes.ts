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
  completedEdges: Set<string>;
  activeEdge: string | null;
  executionOrder: string[];
  stepIndex: number;
  paused: boolean;
}

export interface UseDebuggerReturn {
  breakpoints: Set<string>;
  executionOrder: string[];
  stepIndex: number;
  nodeData: Map<string, DryRunNodeData>;
  paused: boolean;
  completedEdges: Set<string>;
  activeEdge: string | null;
  inspectedNode: string | null;
  panelCollapsed: boolean;
  cycleNodeIds: Set<string>;
  currentNodeId: string | null;
  isFinished: boolean;
  isStarted: boolean;
  inspectedData: DryRunNodeData | null;
  timeline: { id: string; name: string; role: string; data: DryRunNodeData | undefined; hasBreakpoint: boolean }[];
  toggleBreakpoint: (memberId: string) => void;
  handlePlay: () => void;
  handlePause: () => void;
  handleStepForward: () => void;
  handleStop: () => void;
  setInspectedNode: (id: string | null) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
}
