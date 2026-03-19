/**
 * Types for the Persona Composition Engine — multi-agent DAG workflows.
 *
 * A Workflow is a directed acyclic graph (DAG) where each node wraps a
 * persona and edges define data-flow between them.  The engine walks the
 * graph in topological order, feeding each persona's output as input to
 * downstream nodes.
 */

// ── Persisted workflow definition ──────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  description: string;
  /** Serialised DAG nodes (persisted as JSON). */
  nodes: WorkflowNode[];
  /** Serialised DAG edges (persisted as JSON). */
  edges: WorkflowEdge[];
  /** Optional global input schema hint shown to the user at run-time. */
  inputSchema?: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ── DAG node ────────────────────────────────────────────────────────────

export type WorkflowNodeKind = 'persona' | 'input' | 'output';

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  /** Reference to a persona (only for kind === 'persona'). */
  personaId?: string;
  /** Human label shown on the canvas. */
  label: string;
  /** Canvas position. */
  position: { x: number; y: number };
  /** Optional static input data injected before execution. */
  staticInput?: string;
  /** Optional JSONPath expression to extract a subset of the output. */
  outputSelector?: string;
}

// ── DAG edge (data-flow) ────────────────────────────────────────────────

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Optional label describing what data flows along this edge. */
  label?: string;
}

// ── Execution state ─────────────────────────────────────────────────────

export type WorkflowExecutionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowNodeStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface WorkflowNodeExecution {
  nodeId: string;
  status: WorkflowNodeStatus;
  /** Persona execution ID (if applicable). */
  executionId?: string;
  /** Output captured from this node. */
  output?: string;
  /** Error message on failure. */
  error?: string;
  startedAt?: string;
  completedAt?: string;
  /** Wall-clock duration in milliseconds (completedAt - startedAt). */
  duration_ms?: number;
  /** Time spent inside the LLM execution (from the backend record), in ms. */
  execution_ms?: number;
  /** Time spent polling / waiting (duration_ms - execution_ms), in ms. */
  poll_overhead_ms?: number;
  /** LLM cost in USD for this node's execution. */
  cost_usd?: number;
  /** LLM input tokens consumed by this node. */
  input_tokens?: number;
  /** LLM output tokens produced by this node. */
  output_tokens?: number;
  /** True when the node hit the polling timeout without completing. */
  timedOut?: boolean;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowExecutionStatus;
  /** Per-node execution state. */
  nodeExecutions: Record<string, WorkflowNodeExecution>;
  /** Global input provided at run time. */
  input?: string;
  /** Final aggregated output. */
  output?: string;
  startedAt: string;
  completedAt?: string;
  /** Total wall-clock duration in milliseconds. */
  total_duration_ms?: number;
  /** Sum of cost_usd across all persona nodes. */
  total_cost_usd?: number;
  /** Sum of input_tokens across all persona nodes. */
  total_input_tokens?: number;
  /** Sum of output_tokens across all persona nodes. */
  total_output_tokens?: number;
  /** Correlation ID linking all per-node execution traces in this DAG run. */
  workflow_trace_id?: string;
}
