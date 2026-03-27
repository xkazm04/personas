/**
 * Composition slice — manages multi-agent DAG workflows.
 *
 * Workflows are persisted locally via localStorage (no Rust backend table yet).
 * The slice exposes CRUD operations and a DAG execution runner that walks
 * the graph topologically, feeding persona output downstream.
 */
import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("composition");
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowExecution,
  WorkflowNodeExecution,
} from "@/lib/types/compositionTypes";
import type { CompiledWorkflow } from "@/lib/bindings";
import { topologicalSort, validateWorkflow, getUpstream } from "@/features/composition/libs/dagUtils";
import { measureStoreAction } from "@/lib/utils/storePerf";
import { getExecution as fetchExecutionRecord } from "@/api/agents/executions";

const STORAGE_KEY = "__personas_workflows";

function loadWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWorkflows(workflows: Workflow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
}

function uid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface CompositionSlice {
  // State
  workflows: Workflow[];
  selectedWorkflowId: string | null;
  workflowExecution: WorkflowExecution | null;
  isCompiling: boolean;
  lastCompiledWorkflow: CompiledWorkflow | null;

  // CRUD
  fetchWorkflows: () => void;
  createWorkflow: (name: string, description?: string) => string;
  updateWorkflow: (id: string, patch: Partial<Pick<Workflow, "name" | "description" | "nodes" | "edges" | "enabled" | "inputSchema">>) => void;
  deleteWorkflow: (id: string) => void;
  selectWorkflow: (id: string | null) => void;

  // Node / edge mutations (convenience wrappers)
  addWorkflowNode: (workflowId: string, node: WorkflowNode) => void;
  updateWorkflowNode: (workflowId: string, nodeId: string, patch: Partial<WorkflowNode>) => void;
  removeWorkflowNode: (workflowId: string, nodeId: string) => void;
  addWorkflowEdge: (workflowId: string, edge: WorkflowEdge) => void;
  removeWorkflowEdge: (workflowId: string, edgeId: string) => void;

  // Compilation (natural language → workflow)
  compileWorkflow: (description: string) => Promise<void>;

  // Execution
  executeWorkflow: (workflowId: string, input?: string) => Promise<void>;
  cancelWorkflowExecution: () => void;
}

export const createCompositionSlice: StateCreator<PipelineStore, [], [], CompositionSlice> = (set, get) => ({
  workflows: [],
  selectedWorkflowId: null,
  workflowExecution: null,
  isCompiling: false,
  lastCompiledWorkflow: null,

  // ── CRUD ──────────────────────────────────────────────────────────────

  fetchWorkflows: () => {
    set({ workflows: loadWorkflows(), error: null });
  },

  createWorkflow: (name, description = "") => {
    const id = uid();
    const workflow: Workflow = {
      id,
      name,
      description,
      nodes: [],
      edges: [],
      enabled: true,
      created_at: now(),
      updated_at: now(),
    };
    const updated = [...get().workflows, workflow];
    saveWorkflows(updated);
    set({ workflows: updated, selectedWorkflowId: id, error: null });
    return id;
  },

  updateWorkflow: (id, patch) => {
    const updated = get().workflows.map((w) =>
      w.id === id ? { ...w, ...patch, updated_at: now() } : w,
    );
    saveWorkflows(updated);
    set({ workflows: updated, error: null });
  },

  deleteWorkflow: (id) => {
    const updated = get().workflows.filter((w) => w.id !== id);
    saveWorkflows(updated);
    set({
      workflows: updated,
      selectedWorkflowId: get().selectedWorkflowId === id ? null : get().selectedWorkflowId,
      error: null,
    });
  },

  selectWorkflow: (id) => {
    set({ selectedWorkflowId: id });
  },

  // ── Node / edge helpers ───────────────────────────────────────────────

  addWorkflowNode: (workflowId, node) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    get().updateWorkflow(workflowId, { nodes: [...wf.nodes, node] });
  },

  updateWorkflowNode: (workflowId, nodeId, patch) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    get().updateWorkflow(workflowId, {
      nodes: wf.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    });
  },

  removeWorkflowNode: (workflowId, nodeId) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    get().updateWorkflow(workflowId, {
      nodes: wf.nodes.filter((n) => n.id !== nodeId),
      edges: wf.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    });
  },

  addWorkflowEdge: (workflowId, edge) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    get().updateWorkflow(workflowId, { edges: [...wf.edges, edge] });
  },

  removeWorkflowEdge: (workflowId, edgeId) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    get().updateWorkflow(workflowId, {
      edges: wf.edges.filter((e) => e.id !== edgeId),
    });
  },

  // ── Compilation (natural language → workflow) ────────────────────────

  compileWorkflow: async (description) => {
    set({ isCompiling: true, error: null });
    try {
      await measureStoreAction('compileWorkflow', async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<CompiledWorkflow>("compile_workflow", {
          description,
        });

        // Convert the compiled team blueprint into a local Workflow so it
        // appears on the canvas immediately.
        const nodes: WorkflowNode[] = result.blueprint.members.map((m, i) => ({
          id: `node-${i}-${uid()}`,
          kind: "persona" as const,
          personaId: m.persona_id,
          label: m.persona_name,
          position: { x: m.position_x, y: m.position_y },
        }));

        const edges: WorkflowEdge[] = result.blueprint.connections
          .filter((c) => c.source_index < nodes.length && c.target_index < nodes.length)
          .map((c) => ({
            id: `edge-${uid()}`,
            source: nodes[c.source_index]!.id,
            target: nodes[c.target_index]!.id,
            label: c.connection_type,
          }));

        const workflowId = uid();
        const workflow: Workflow = {
          id: workflowId,
          name: result.team.name,
          description: result.blueprint.description,
          nodes,
          edges,
          enabled: true,
          created_at: now(),
          updated_at: now(),
        };

        const updated = [...get().workflows, workflow];
        saveWorkflows(updated);
        set({
          workflows: updated,
          selectedWorkflowId: workflowId,
          isCompiling: false,
          lastCompiledWorkflow: result,
          error: null,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reportError(new Error(msg), msg, set);
      set({ isCompiling: false });
    }
  },

  // ── Execution ─────────────────────────────────────────────────────────

  executeWorkflow: async (workflowId, input) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) {
      reportError(new Error("Workflow not found"), "Workflow not found", set);
      return;
    }

    const errors = validateWorkflow(wf.nodes, wf.edges);
    if (errors.length > 0) {
      const msg = errors[0]?.message ?? "Workflow validation failed";
      reportError(new Error(msg), msg, set);
      return;
    }

    await measureStoreAction('executeWorkflow', async () => {
      const workflowStartMs = performance.now();
      const { sorted } = topologicalSort(wf.nodes, wf.edges);
      const nodeMap = new Map(wf.nodes.map((n) => [n.id, n]));

      // Initialise execution state
      const nodeExecutions: Record<string, WorkflowNodeExecution> = {};
      for (const nodeId of sorted) {
        nodeExecutions[nodeId] = { nodeId, status: "pending" };
      }

      const workflowTraceId = uid();
      const execution: WorkflowExecution = {
        id: uid(),
        workflowId,
        status: "running",
        nodeExecutions: { ...nodeExecutions },
        input,
        startedAt: now(),
        workflow_trace_id: workflowTraceId,
      };
      set({ workflowExecution: execution });

      logger.debug("Workflow started", { workflowId, nodeCount: sorted.length });

      // Helper: derive next state from the latest accumulated store state,
      // ensuring completed node outputs are never lost when a later node fails.
      const setExecution = (overrides: Partial<WorkflowExecution>) => {
        const latest = get().workflowExecution;
        if (!latest) return;
        set({
          workflowExecution: {
            ...latest,
            nodeExecutions: { ...nodeExecutions },
            ...overrides,
          },
        });
      };

      // Collect outputs per node (used to pass downstream)
      const outputs = new Map<string, string>();

      // If there's an input node, seed it
      const inputNode = wf.nodes.find((n) => n.kind === "input");
      if (inputNode && input) {
        outputs.set(inputNode.id, input);
        const inputTs = now();
        nodeExecutions[inputNode.id] = {
          nodeId: inputNode.id,
          status: "completed",
          output: input,
          startedAt: inputTs,
          completedAt: inputTs,
          duration_ms: 0,
        };
        setExecution({});
      }

      // Walk topological order
      for (const nodeId of sorted) {
        // Check cancellation
        if (get().workflowExecution?.status === "cancelled") break;

        const node = nodeMap.get(nodeId)!;

        // Input nodes already handled
        if (node.kind === "input") continue;

        // Gather upstream outputs
        const upstreamIds = getUpstream(nodeId, wf.edges);
        const upstreamOutputs = upstreamIds
          .map((id) => outputs.get(id))
          .filter((o): o is string => o !== undefined);
        const mergedInput = node.staticInput
          ? [node.staticInput, ...upstreamOutputs].join("\n\n---\n\n")
          : upstreamOutputs.join("\n\n---\n\n");

        // Output nodes just pass through
        if (node.kind === "output") {
          outputs.set(nodeId, mergedInput);
          const outputTs = now();
          nodeExecutions[nodeId] = {
            nodeId,
            status: "completed",
            output: mergedInput,
            startedAt: outputTs,
            completedAt: outputTs,
            duration_ms: 0,
          };
          setExecution({});
          continue;
        }

        // Persona node: execute via the agent store
        if (node.kind === "persona" && node.personaId) {
          const startedAt = now();
          const nodeStartMs = performance.now();
          nodeExecutions[nodeId] = { nodeId, status: "running", startedAt };
          setExecution({});

          try {
            const { useAgentStore } = await import("@/stores/agentStore");
            const agentState = useAgentStore.getState();
            const inputData = mergedInput ? { prompt: mergedInput } : undefined;
            const execId = await agentState.executePersona(node.personaId, inputData);

            // Wait for execution to finish (poll every 500ms, max 5 min).
            // Check both activeExecutionId and lastExecutionId because
            // finishExecution clears activeExecutionId synchronously after
            // setting isExecuting=false — the poll may only see the final state.
            const maxWait = 300_000;
            const pollInterval = 500;
            let elapsed = 0;
            while (elapsed < maxWait) {
              const current = useAgentStore.getState();
              if (
                !current.isExecuting &&
                (current.activeExecutionId === execId || current.lastExecutionId === execId)
              ) break;
              await new Promise((r) => setTimeout(r, pollInterval));
              elapsed += pollInterval;
              if (get().workflowExecution?.status === "cancelled") break;
            }

            const completedAt = now();
            const duration_ms = Math.round(performance.now() - nodeStartMs);
            const timedOut = elapsed >= maxWait;

            if (timedOut) {
              logger.warn("Workflow node timed out", { nodeId, nodeLabel: node.label, maxWaitMs: maxWait });
            }

            // Capture output from the per-execution snapshot (populated by
            // finishExecution) so that the shared executionOutput array — which
            // gets cleared on the next executePersona call — cannot race us.
            const finalState = useAgentStore.getState();
            const snapshotLines = execId
              ? finalState.consumeCompletedOutput(execId)
              : undefined;
            const outputText = (snapshotLines ?? finalState.executionOutput).join("\n");

            // Fetch the backend execution record to extract cost / token metrics
            let nodeCostUsd: number | undefined;
            let nodeInputTokens: number | undefined;
            let nodeOutputTokens: number | undefined;
            let executionMs: number | undefined;
            if (execId && node.personaId) {
              try {
                const record = await fetchExecutionRecord(execId, node.personaId);
                if (record) {
                  nodeCostUsd = record.cost_usd || undefined;
                  nodeInputTokens = record.input_tokens || undefined;
                  nodeOutputTokens = record.output_tokens || undefined;
                  executionMs = record.duration_ms ?? undefined;
                }
              } catch {
                // Non-fatal — metrics are best-effort
              }
            }

            const pollOverheadMs = executionMs != null ? Math.max(0, duration_ms - executionMs) : undefined;

            outputs.set(nodeId, outputText);
            nodeExecutions[nodeId] = {
              nodeId,
              status: timedOut ? "failed" : "completed",
              executionId: execId ?? undefined,
              output: outputText,
              error: timedOut ? `Polling timeout after ${maxWait / 1000}s` : undefined,
              startedAt,
              completedAt,
              duration_ms,
              execution_ms: executionMs,
              poll_overhead_ms: pollOverheadMs,
              cost_usd: nodeCostUsd,
              input_tokens: nodeInputTokens,
              output_tokens: nodeOutputTokens,
              timedOut,
            };
            setExecution(timedOut ? { status: "failed", completedAt } : {});

            logger.debug("Workflow node finished", { nodeId, nodeLabel: node.label, status: timedOut ? "timed_out" : "completed", durationMs: duration_ms, executionMs: executionMs ?? null, costUsd: nodeCostUsd ?? null, inputTokens: nodeInputTokens ?? 0, outputTokens: nodeOutputTokens ?? 0 });

            if (timedOut) return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Execution failed";
            const completedAt = now();
            const duration_ms = Math.round(performance.now() - nodeStartMs);
            nodeExecutions[nodeId] = {
              nodeId,
              status: "failed",
              error: msg,
              startedAt,
              completedAt,
              duration_ms,
            };
            setExecution({ status: "failed", completedAt });
            logger.error("Workflow node failed", { nodeId, nodeLabel: node.label, durationMs: duration_ms, error: msg });
            return;
          }
        }
      }

      // Determine final output from leaf/output nodes
      const outputNode = wf.nodes.find((n) => n.kind === "output");
      const lastSorted = sorted[sorted.length - 1];
      const finalOutput = outputNode
        ? outputs.get(outputNode.id)
        : lastSorted ? outputs.get(lastSorted) : undefined;

      const total_duration_ms = Math.round(performance.now() - workflowStartMs);
      const finalStatus = get().workflowExecution?.status === "cancelled" ? "cancelled" : "completed";

      // Aggregate cost / token totals across all persona nodes
      let totalCost = 0;
      let totalIn = 0;
      let totalOut = 0;
      for (const ne of Object.values(nodeExecutions)) {
        if (ne.cost_usd) totalCost += ne.cost_usd;
        if (ne.input_tokens) totalIn += ne.input_tokens;
        if (ne.output_tokens) totalOut += ne.output_tokens;
      }

      setExecution({
        status: finalStatus,
        output: finalOutput,
        completedAt: now(),
        total_duration_ms,
        total_cost_usd: totalCost || undefined,
        total_input_tokens: totalIn || undefined,
        total_output_tokens: totalOut || undefined,
      });

      logger.debug("Workflow completed", { workflowId, status: finalStatus, totalDurationMs: total_duration_ms, totalCostUsd: totalCost, totalInputTokens: totalIn, totalOutputTokens: totalOut, traceId: workflowTraceId });
    });
  },

  cancelWorkflowExecution: () => {
    const current = get().workflowExecution;
    if (current && current.status === "running") {
      set({
        workflowExecution: { ...current, status: "cancelled", completedAt: now() },
      });
    }
  },
});
