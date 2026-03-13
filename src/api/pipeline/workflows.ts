import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { WorkflowsOverview } from "@/lib/bindings/WorkflowsOverview";

export type { WorkflowJob } from "@/lib/bindings/WorkflowJob";
export type { WorkflowsOverview } from "@/lib/bindings/WorkflowsOverview";

// -- API ----------------------------------------------------------------

export const getWorkflowsOverview = () =>
  invoke<WorkflowsOverview>("get_workflows_overview");

export const getWorkflowJobOutput = (jobType: string, jobId: string) =>
  invoke<string[]>("get_workflow_job_output", { jobType, jobId });

export const cancelWorkflowJob = (jobType: string, jobId: string) =>
  invoke<void>("cancel_workflow_job", { jobType, jobId });
