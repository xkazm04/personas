/**
 * Composition slice — manages multi-agent DAG workflows.
 *
 * Workflows are persisted via Tauri backend SQLite (composition_workflows table).
 * Falls back to localStorage for migration: on first fetch, if the backend returns
 * empty but localStorage has data, bulk-imports to the backend and clears localStorage.
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
import * as workflowApi from "@/api/composition";

// ── localStorage migration helpers ─────────────────────────────────────

const LEGACY_STORAGE_KEY = "__personas_workflows";
const MIGRATION_DONE_KEY = "__personas_workflows_migrated";

function loadLegacyWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function clearLegacyWorkflows() {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.setItem(MIGRATION_DONE_KEY, "true");
}

function isMigrationDone(): boolean {
  return localStorage.getItem(MIGRATION_DONE_KEY) === "true";
}

/** Convert a Workflow (frontend type) to the API row format for import. */
function workflowToRow(wf: Workflow): workflowApi.CompositionWorkflowRow {
  return {
    id: wf.id,
    name: wf.name,
    description: wf.description,
    nodesJson: JSON.stringify(wf.nodes),
    edgesJson: JSON.stringify(wf.edges),
    inputSchemaJson: wf.inputSchema ? JSON.stringify(wf.inputSchema) : null,
    enabled: wf.enabled,
    createdAt: wf.created_at,
    updatedAt: wf.updated_at,
  };
}

/** Convert a backend row to the frontend Workflow type. */
function rowToWorkflow(row: workflowApi.CompositionWorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    nodes: safeParse<WorkflowNode[]>(row.nodesJson, []),
    edges: safeParse<WorkflowEdge[]>(row.edgesJson, []),
    inputSchema: row.inputSchemaJson ? safeParse<Record<string, string>>(row.inputSchemaJson, {}) : undefined,
    enabled: row.enabled,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function safeParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json); }
  catch { return fallback; }
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
  fetchWorkflows: () => Promise<void>;
  createWorkflow: (name: string, description?: string) => Promise<string>;
  updateWorkflow: (id: string, patch: Partial<Pick<Workflow, "name" | "description" | "nodes" | "edges" | "enabled" | "inputSchema">>) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
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

  fetchWorkflows: async () => {
    try {
      const rows = await workflowApi.listCompositionWorkflows();
      let workflows = rows.map(rowToWorkflow);

      // Migration: if backend is empty but localStorage has data, import it
      if (workflows.length === 0 && !isMigrationDone()) {
        const legacy = loadLegacyWorkflows();
        if (legacy.length > 0) {
          logger.info(`Migrating ${legacy.length} workflows from localStorage to SQLite`);
          try {
            const imported = await workflowApi.importCompositionWorkflows(legacy.map(workflowToRow));
            logger.info(`Migrated ${imported} workflows to SQLite`);
            clearLegacyWorkflows();
            // Re-fetch from backend after import
            const freshRows = await workflowApi.listCompositionWorkflows();
            workflows = freshRows.map(rowToWorkflow);
          } catch (migrationErr) {
            logger.error("localStorage → SQLite migration failed, falling back to localStorage", { error: String(migrationErr) });
            workflows = legacy;
          }
        } else {
          // No legacy data either — mark migration as done
          clearLegacyWorkflows();
        }
      }

      set({ workflows, error: null });
    } catch {
      // Backend not available — fall back to localStorage
      logger.warn("Backend unavailable, falling back to localStorage for workflows");
      set({ workflows: loadLegacyWorkflows(), error: null });
    }
  },

  createWorkflow: async (name, description = "") => {
    const id = uid();
    // Optimistic update: add to local state immediately
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
    set({ workflows: updated, selectedWorkflowId: id, error: null });

    // Persist to backend
    try {
      await workflowApi.createCompositionWorkflow({
        name,
        description,
      });
    } catch (err) {
      logger.error("Failed to persist workflow to backend", { error: String(err) });
    }
    return id;
  },

  updateWorkflow: async (id, patch) => {
    // Optimistic update
    const updated = get().workflows.map((w) =>
      w.id === id ? { ...w, ...patch, updated_at: now() } : w,
    );
    set({ workflows: updated, error: null });

    // Persist to backend
    try {
      const input: workflowApi.UpdateCompositionWorkflowInput = {};
      if (patch.name !== undefined) input.name = patch.name;
      if (patch.description !== undefined) input.description = patch.description;
      if (patch.nodes !== undefined) input.nodesJson = JSON.stringify(patch.nodes);
      if (patch.edges !== undefined) input.edgesJson = JSON.stringify(patch.edges);
      if (patch.enabled !== undefined) input.enabled = patch.enabled;
      if (patch.inputSchema !== undefined) input.inputSchemaJson = JSON.stringify(patch.inputSchema);
      await workflowApi.updateCompositionWorkflow(id, input);
    } catch (err) {
      logger.error("Failed to persist workflow update to backend", { error: String(err) });
    }
  },

  deleteWorkflow: async (id) => {
    // Optimistic update
    const updated = get().workflows.filter((w) => w.id !== id);
    set({
      workflows: updated,
      selectedWorkflowId: get().selectedWorkflowId === id ? null : get().selectedWorkflowId,
      error: null,
    });

    // Persist to backend
    try {
      await workflowApi.deleteCompositionWorkflow(id);
    } catch (err) {
      logger.error("Failed to delete workflow from backend", { error: String(err) });
    }
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
        set({
          workflows: updated,
          selectedWorkflowId: workflowId,
          isCompiling: false,
          lastCompiledWorkflow: result,
          error: null,
        });

        // Persist compiled workflow to backend
        try {
          await workflowApi.createCompositionWorkflow({
            name: workflow.name,
            description: workflow.description,
            nodesJson: JSON.stringify(workflow.nodes),
            edgesJson: JSON.stringify(workflow.edges),
          });
        } catch (err) {
          logger.error("Failed to persist compiled workflow to backend", { error: String(err) });
        }
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

      const outputs = new Map<string, string>();

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

      for (const nodeId of sorted) {
        if (get().workflowExecution?.status === "cancelled") break;

        const node = nodeMap.get(nodeId)!;

        if (node.kind === "input") continue;

        const upstreamIds = getUpstream(nodeId, wf.edges);
        const upstreamOutputs = upstreamIds
          .map((id) => outputs.get(id))
          .filter((o): o is string => o !== undefined);
        const mergedInput = node.staticInput
          ? [node.staticInput, ...upstreamOutputs].join("\n\n---\n\n")
          : upstreamOutputs.join("\n\n---\n\n");

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

            const finalState = useAgentStore.getState();
            const snapshotLines = execId
              ? finalState.consumeCompletedOutput(execId)
              : undefined;
            const outputText = (snapshotLines ?? finalState.executionOutput).join("\n");

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
                // Non-fatal
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

      const outputNode = wf.nodes.find((n) => n.kind === "output");
      const lastSorted = sorted[sorted.length - 1];
      const finalOutput = outputNode
        ? outputs.get(outputNode.id)
        : lastSorted ? outputs.get(lastSorted) : undefined;

      const total_duration_ms = Math.round(performance.now() - workflowStartMs);
      const finalStatus = get().workflowExecution?.status === "cancelled" ? "cancelled" : "completed";

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
