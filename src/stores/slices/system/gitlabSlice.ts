import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { translateGitLabError } from "./deployTarget";
import { emitDeploymentEvent } from "@/hooks/realtime/emitDeploymentEvent";
import {
  gitlabConnect,
  gitlabDisconnect,
  gitlabGetConfig,
  gitlabListProjects,
  gitlabDeployPersona,
  gitlabListAgents,
  gitlabUndeployAgent,
  gitlabRevokeCredentials,
  gitlabTriggerPipeline,
  gitlabGetPipeline,
  gitlabListPipelines,
  gitlabListPipelineJobs,
  gitlabGetJobLog,
  type GitLabConfig,
  type GitLabProject,
  type GitLabAgent,
  type GitLabDeployResult,
  type GitLabPipeline,
  type GitLabJob,
} from "@/api/system/gitlab";

export interface GitLabSlice {
  // State
  gitlabConfig: GitLabConfig | null;
  gitlabIsConnecting: boolean;
  gitlabProjects: GitLabProject[];
  gitlabAgents: GitLabAgent[];
  gitlabError: string | null;
  gitlabSelectedProjectId: number | null;

  // Pipeline state
  gitlabPipelines: GitLabPipeline[];
  gitlabActivePipeline: GitLabPipeline | null;
  gitlabPipelineJobs: GitLabJob[];
  gitlabJobLog: string | null;
  gitlabPipelineLoading: boolean;
  gitlabTriggeringPipeline: boolean;

  // Actions
  gitlabInitialize: () => Promise<void>;
  gitlabConnectAction: (token: string) => Promise<void>;
  gitlabDisconnectAction: () => Promise<void>;
  gitlabFetchProjects: () => Promise<void>;
  gitlabDeployPersona: (
    personaId: string,
    projectId: number,
    provisionCredentials: boolean,
  ) => Promise<GitLabDeployResult>;
  gitlabRevokeCredentials: (
    projectId: number,
    variableKeys: string[],
  ) => Promise<number>;
  gitlabFetchAgents: (projectId: number) => Promise<void>;
  gitlabUndeployAgent: (projectId: number, agentId: string) => Promise<void>;
  gitlabClearError: () => void;

  // Pipeline actions
  gitlabFetchPipelines: (projectId: number) => Promise<void>;
  gitlabTriggerPipelineAction: (projectId: number, ref?: string) => Promise<GitLabPipeline | null>;
  gitlabSelectPipeline: (projectId: number, pipelineId: number) => Promise<void>;
  gitlabRefreshPipeline: (projectId: number, pipelineId: number) => Promise<void>;
  gitlabFetchJobLog: (projectId: number, jobId: number) => Promise<void>;
  gitlabClearPipelineState: () => void;
}

export const createGitLabSlice: StateCreator<SystemStore, [], [], GitLabSlice> = (set) => ({
  gitlabConfig: null,
  gitlabIsConnecting: false,
  gitlabProjects: [],
  gitlabAgents: [],
  gitlabError: null,
  gitlabSelectedProjectId: null,
  gitlabPipelines: [],
  gitlabActivePipeline: null,
  gitlabPipelineJobs: [],
  gitlabJobLog: null,
  gitlabPipelineLoading: false,
  gitlabTriggeringPipeline: false,

  gitlabInitialize: async () => {
    try {
      const config = await gitlabGetConfig();
      set({ gitlabConfig: config });
    } catch {
      // intentional: non-critical -- no config stored yet is expected on first launch
    }
  },

  gitlabConnectAction: async (token: string) => {
    set({ gitlabIsConnecting: true, gitlabError: null });
    try {
      await gitlabConnect(token);
      const config = await gitlabGetConfig();
      set({ gitlabConfig: config, gitlabIsConnecting: false });
    } catch (err) {
      set({ gitlabIsConnecting: false, gitlabError: translateGitLabError(err) });
      throw err;
    }
  },

  gitlabDisconnectAction: async () => {
    try {
      await gitlabDisconnect();
      set({
        gitlabConfig: null,
        gitlabProjects: [],
        gitlabAgents: [],
        gitlabError: null,
        gitlabSelectedProjectId: null,
      });
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },

  gitlabFetchProjects: async () => {
    try {
      const projects = await gitlabListProjects();
      set({ gitlabProjects: projects, gitlabError: null });
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },

  gitlabDeployPersona: async (
    personaId: string,
    projectId: number,
    provisionCredentials: boolean,
  ) => {
    emitDeploymentEvent({ eventType: 'deploy_started', target: 'gitlab', personaId, status: 'pending' });
    try {
      const result = await gitlabDeployPersona(personaId, projectId, provisionCredentials);
      set({ gitlabError: null });
      emitDeploymentEvent({ eventType: 'deploy_succeeded', target: 'gitlab', personaId, detail: `project:${projectId}` });
      if (provisionCredentials) {
        emitDeploymentEvent({ eventType: 'credential_provisioned', target: 'gitlab', personaId, detail: `project:${projectId}` });
      }
      return result;
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
      emitDeploymentEvent({ eventType: 'deploy_failed', target: 'gitlab', personaId, status: 'failed' });
      throw err;
    }
  },

  gitlabRevokeCredentials: async (projectId: number, variableKeys: string[]) => {
    try {
      const count = await gitlabRevokeCredentials(projectId, variableKeys);
      set({ gitlabError: null });
      return count;
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
      throw err;
    }
  },

  gitlabFetchAgents: async (projectId: number) => {
    try {
      const agents = await gitlabListAgents(projectId);
      set({ gitlabAgents: agents, gitlabError: null });
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },

  gitlabUndeployAgent: async (projectId: number, agentId: string) => {
    try {
      await gitlabUndeployAgent(projectId, agentId);
      // Refresh the list
      const agents = await gitlabListAgents(projectId);
      set({ gitlabAgents: agents, gitlabError: null });
      emitDeploymentEvent({ eventType: 'agent_undeployed', target: 'gitlab', detail: `agent:${agentId}` });
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },

  gitlabClearError: () => {
    set({ gitlabError: null });
  },

  // -- Pipeline actions --------------------------------------------------

  gitlabFetchPipelines: async (projectId: number) => {
    set({ gitlabPipelineLoading: true });
    try {
      const pipelines = await gitlabListPipelines(projectId, 20);
      set({ gitlabPipelines: pipelines, gitlabPipelineLoading: false, gitlabError: null });
    } catch (err) {
      set({ gitlabPipelineLoading: false, gitlabError: translateGitLabError(err) });
    }
  },

  gitlabTriggerPipelineAction: async (projectId: number, ref?: string) => {
    set({ gitlabTriggeringPipeline: true, gitlabError: null });
    try {
      const pipeline = await gitlabTriggerPipeline(projectId, ref);
      set((state) => ({
        gitlabTriggeringPipeline: false,
        gitlabActivePipeline: pipeline,
        gitlabPipelines: [pipeline, ...state.gitlabPipelines],
        gitlabError: null,
      }));
      return pipeline;
    } catch (err) {
      set({ gitlabTriggeringPipeline: false, gitlabError: translateGitLabError(err) });
      return null;
    }
  },

  gitlabSelectPipeline: async (projectId: number, pipelineId: number) => {
    set({ gitlabPipelineLoading: true, gitlabJobLog: null });
    try {
      const [pipeline, jobs] = await Promise.all([
        gitlabGetPipeline(projectId, pipelineId),
        gitlabListPipelineJobs(projectId, pipelineId),
      ]);
      set({ gitlabActivePipeline: pipeline, gitlabPipelineJobs: jobs, gitlabPipelineLoading: false, gitlabError: null });
    } catch (err) {
      set({ gitlabPipelineLoading: false, gitlabError: translateGitLabError(err) });
    }
  },

  gitlabRefreshPipeline: async (projectId: number, pipelineId: number) => {
    try {
      const [pipeline, jobs] = await Promise.all([
        gitlabGetPipeline(projectId, pipelineId),
        gitlabListPipelineJobs(projectId, pipelineId),
      ]);
      set((state) => ({
        gitlabActivePipeline: pipeline,
        gitlabPipelineJobs: jobs,
        gitlabPipelines: state.gitlabPipelines.map((p) => (p.id === pipelineId ? pipeline : p)),
        gitlabError: null,
      }));
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },

  gitlabFetchJobLog: async (projectId: number, jobId: number) => {
    set({ gitlabJobLog: null });
    try {
      const log = await gitlabGetJobLog(projectId, jobId);
      set({ gitlabJobLog: log, gitlabError: null });
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },

  gitlabClearPipelineState: () => {
    set({
      gitlabPipelines: [],
      gitlabActivePipeline: null,
      gitlabPipelineJobs: [],
      gitlabJobLog: null,
    });
  },
});
