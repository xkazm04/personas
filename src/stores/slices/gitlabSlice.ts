import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
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
  type GitLabConfig,
  type GitLabProject,
  type GitLabAgent,
  type GitLabDeployResult,
} from "@/api/gitlab";

export interface GitLabSlice {
  // State
  gitlabConfig: GitLabConfig | null;
  gitlabIsConnecting: boolean;
  gitlabProjects: GitLabProject[];
  gitlabAgents: GitLabAgent[];
  gitlabError: string | null;
  gitlabSelectedProjectId: number | null;

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
}

export const createGitLabSlice: StateCreator<PersonaStore, [], [], GitLabSlice> = (set) => ({
  gitlabConfig: null,
  gitlabIsConnecting: false,
  gitlabProjects: [],
  gitlabAgents: [],
  gitlabError: null,
  gitlabSelectedProjectId: null,

  gitlabInitialize: async () => {
    try {
      const config = await gitlabGetConfig();
      set({ gitlabConfig: config });
    } catch {
      // intentional: non-critical — no config stored yet is expected on first launch
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
});
