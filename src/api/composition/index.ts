import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ── Types ────────────────────────────────────────────────────────────

export interface CompositionWorkflowRow {
  id: string;
  name: string;
  description: string;
  nodesJson: string;
  edgesJson: string;
  inputSchemaJson: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCompositionWorkflowInput {
  name: string;
  description?: string;
  nodesJson?: string;
  edgesJson?: string;
  inputSchemaJson?: string;
  enabled?: boolean;
}

export interface UpdateCompositionWorkflowInput {
  name?: string;
  description?: string;
  nodesJson?: string;
  edgesJson?: string;
  inputSchemaJson?: string;
  enabled?: boolean;
}

// ── CRUD API ─────────────────────────────────────────────────────────

export const listCompositionWorkflows = () =>
  invoke<CompositionWorkflowRow[]>("list_composition_workflows");

export const getCompositionWorkflow = (id: string) =>
  invoke<CompositionWorkflowRow>("get_composition_workflow", { id });

export const createCompositionWorkflow = (input: CreateCompositionWorkflowInput) =>
  invoke<CompositionWorkflowRow>("create_composition_workflow", { input });

export const updateCompositionWorkflow = (id: string, input: UpdateCompositionWorkflowInput) =>
  invoke<CompositionWorkflowRow>("update_composition_workflow", { id, input });

export const deleteCompositionWorkflow = (id: string) =>
  invoke<boolean>("delete_composition_workflow", { id });

export const importCompositionWorkflows = (workflows: CompositionWorkflowRow[]) =>
  invoke<number>("import_composition_workflows", { workflows });
