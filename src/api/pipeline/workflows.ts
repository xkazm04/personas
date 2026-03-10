import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ── Types ──────────────────────────────────────────────────────────────

export interface WorkflowJob {
  job_id: string;
  job_type: "n8n_transform" | "template_adopt" | "template_generate" | "query_debug" | "schema_proposal";
  status: "running" | "completed" | "failed" | "cancelled";
  error: string | null;
  output_tail: string[];
  line_count: number;
  elapsed_secs: number;
}

export interface WorkflowsOverview {
  jobs: WorkflowJob[];
  running_count: number;
  completed_count: number;
  failed_count: number;
  total_count: number;
}

// ── API ────────────────────────────────────────────────────────────────

export const getWorkflowsOverview = () =>
  invoke<WorkflowsOverview>("get_workflows_overview");

export const getWorkflowJobOutput = (jobType: string, jobId: string) =>
  invoke<string[]>("get_workflow_job_output", { jobType, jobId });

export const cancelWorkflowJob = (jobType: string, jobId: string) =>
  invoke<void>("cancel_workflow_job", { jobType, jobId });
