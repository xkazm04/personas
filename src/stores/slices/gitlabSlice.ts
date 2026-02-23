import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
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

/** Translate raw backend error strings into user-friendly messages. */
function translateGitLabError(err: unknown): string {
  const raw = String(err).toLowerCase();

  if (raw.includes("not connected")) {
    return "Not connected to GitLab. Please connect first.";
  }
  if (raw.includes("401") || raw.includes("unauthorized")) {
    return "Invalid personal access token. Please check your token and try again.";
  }
  if (raw.includes("403") || raw.includes("forbidden")) {
    return "Access denied. Your token may not have the required scopes (api, read_api).";
  }
  if (raw.includes("not reachable") || raw.includes("connection refused")) {
    return "Could not reach GitLab. Check your network connection.";
  }
  if (raw.includes("token must not be empty")) {
    return "Please enter your GitLab personal access token.";
  }
  if (raw.includes("keyring")) {
    return "Could not access stored credentials. You may need to reconnect.";
  }

  return String(err).replace(/^GitLab error:\s*/i, "");
}

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
      // No config stored — that's fine
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
    try {
      const result = await gitlabDeployPersona(personaId, projectId, provisionCredentials);
      set({ gitlabError: null });
      return result;
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
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
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },
});
