import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { GitLabConfig } from "@/lib/bindings/GitLabConfig";
import type { GitLabUser } from "@/lib/bindings/GitLabUser";
import type { GitLabProject } from "@/lib/bindings/GitLabProject";
import type { GitLabAgent } from "@/lib/bindings/GitLabAgent";
import type { GitLabDeployResult } from "@/lib/bindings/GitLabDeployResult";
import type { GitLabPipeline } from "@/lib/bindings/GitLabPipeline";
import type { GitLabJob } from "@/lib/bindings/GitLabJob";

export type { GitLabConfig } from "@/lib/bindings/GitLabConfig";
export type { GitLabUser } from "@/lib/bindings/GitLabUser";
export type { GitLabProject } from "@/lib/bindings/GitLabProject";
export type { GitLabAgent } from "@/lib/bindings/GitLabAgent";
export type { GitLabAgentDefinition } from "@/lib/bindings/GitLabAgentDefinition";
export type { GitLabAgentTool } from "@/lib/bindings/GitLabAgentTool";
export type { GitLabDeployResult } from "@/lib/bindings/GitLabDeployResult";
export type { GitLabPipeline } from "@/lib/bindings/GitLabPipeline";
export type { GitLabJob } from "@/lib/bindings/GitLabJob";

// Connection
export const gitlabConnect = (token: string) =>
  invoke<GitLabUser>("gitlab_connect", { token });

export const gitlabDisconnect = () =>
  invoke<void>("gitlab_disconnect");

export const gitlabGetConfig = () =>
  invoke<GitLabConfig | null>("gitlab_get_config");

// Projects
export const gitlabListProjects = () =>
  invoke<GitLabProject[]>("gitlab_list_projects");

// Deploy
export const gitlabDeployPersona = (
  personaId: string,
  projectId: number,
  provisionCredentials: boolean,
) =>
  invoke<GitLabDeployResult>("gitlab_deploy_persona", {
    personaId,
    projectId,
    provisionCredentials,
  });

// Credential revocation
export const gitlabRevokeCredentials = (
  projectId: number,
  variableKeys: string[],
) =>
  invoke<number>("gitlab_revoke_credentials", { projectId, variableKeys });

// Agents
export const gitlabListAgents = (projectId: number) =>
  invoke<GitLabAgent[]>("gitlab_list_agents", { projectId });

export const gitlabUndeployAgent = (projectId: number, agentId: string) =>
  invoke<void>("gitlab_undeploy_agent", { projectId, agentId });

// Pipelines

export const gitlabTriggerPipeline = (projectId: number, ref?: string) =>
  invoke<GitLabPipeline>("gitlab_trigger_pipeline", {
    projectId,
    ref: ref ?? null,
  });

export const gitlabGetPipeline = (projectId: number, pipelineId: number) =>
  invoke<GitLabPipeline>("gitlab_get_pipeline", { projectId, pipelineId });

export const gitlabListPipelines = (projectId: number, limit?: number) =>
  invoke<GitLabPipeline[]>("gitlab_list_pipelines", {
    projectId,
    limit: limit ?? null,
  });

export const gitlabListPipelineJobs = (projectId: number, pipelineId: number) =>
  invoke<GitLabJob[]>("gitlab_list_pipeline_jobs", { projectId, pipelineId });

export const gitlabGetJobLog = (projectId: number, jobId: number) =>
  invoke<string>("gitlab_get_job_log", { projectId, jobId });
