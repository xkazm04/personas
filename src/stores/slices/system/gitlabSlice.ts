import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { translateGitLabError } from "./deployTarget";
import { emitDeploymentEvent } from "@/hooks/realtime/emitDeploymentEvent";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { Persona } from "@/lib/types/types";
import {
  gitlabConnect,
  gitlabConnectFromVault,
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
  gitlabListPersonaVersions,
  gitlabDeployPersonaVersioned,
  gitlabRollbackPersona,
  gitlabListPersonaBranches,
  gitlabSetupPersonaBranches,
  gitlabListDeploymentHistory,
  gitlabRollbackFromHistory,
  type GitLabConfig,
  type GitLabProject,
  type GitLabAgent,
  type GitLabDeployResult,
  type GitLabPipeline,
  type GitLabJob,
  type GitLabPersonaVersion,
  type GitLabRollbackResult,
  type GitLabPersonaBranch,
  type GitLabDeploymentRecord,
} from "@/api/system/gitlab";

export interface GitLabDeploymentMeta {
  personaId: string;
  projectId: number;
}

export interface GitLabSlice {
  // State
  gitlabConfig: GitLabConfig | null;
  gitlabIsConnecting: boolean;
  gitlabProjects: GitLabProject[];
  gitlabAgents: GitLabAgent[];
  gitlabError: string | null;
  gitlabSelectedProjectId: number | null;
  gitlabDeploymentMeta: Record<string, GitLabDeploymentMeta>;
  gitlabRedeployingAgentId: string | null;

  // Pipeline state
  gitlabPipelines: GitLabPipeline[];
  gitlabActivePipeline: GitLabPipeline | null;
  gitlabPipelineJobs: GitLabJob[];
  gitlabJobLog: string | null;
  gitlabPipelineLoading: boolean;
  gitlabTriggeringPipeline: boolean;

  // Actions
  gitlabInitialize: () => Promise<void>;
  gitlabConnectAction: (token: string, instanceUrl?: string) => Promise<void>;
  gitlabConnectFromVaultAction: (credentialId: string, instanceUrl?: string) => Promise<void>;
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
  gitlabRedeployAgent: (agentName: string) => Promise<GitLabDeployResult>;
  gitlabClearError: () => void;

  // Pipeline actions
  gitlabFetchPipelines: (projectId: number) => Promise<void>;
  gitlabTriggerPipelineAction: (projectId: number, ref?: string) => Promise<GitLabPipeline | null>;
  gitlabSelectPipeline: (projectId: number, pipelineId: number) => Promise<void>;
  gitlabRefreshPipeline: (projectId: number, pipelineId: number) => Promise<void>;
  gitlabFetchJobLog: (projectId: number, jobId: number) => Promise<void>;
  gitlabClearPipelineState: () => void;

  // GitOps versioning state
  gitlabPersonaVersions: GitLabPersonaVersion[];
  gitlabPersonaBranches: GitLabPersonaBranch[];
  gitlabVersionsLoading: boolean;
  gitlabRollingBack: boolean;

  // GitOps versioning actions
  gitlabFetchPersonaVersions: (projectId: number, personaName: string) => Promise<void>;
  gitlabDeployPersonaVersioned: (
    personaId: string,
    projectId: number,
    provisionCredentials: boolean,
    environment?: string,
  ) => Promise<GitLabDeployResult>;
  gitlabRollbackPersona: (
    projectId: number,
    personaName: string,
    targetTag: string,
  ) => Promise<GitLabRollbackResult>;
  gitlabFetchPersonaBranches: (projectId: number, personaName: string) => Promise<void>;
  gitlabSetupPersonaBranches: (projectId: number, personaName: string) => Promise<GitLabPersonaBranch[]>;

  // Deployment history state
  gitlabDeploymentHistory: GitLabDeploymentRecord[];
  gitlabDeploymentHistoryLoading: boolean;
  gitlabRollingBackFromHistory: boolean;

  // Deployment history actions
  gitlabFetchDeploymentHistory: (projectId: number, personaId?: string) => Promise<void>;
  gitlabRollbackFromHistory: (projectId: number, deploymentId: string) => Promise<GitLabDeployResult>;
}

const DEPLOY_META_KEY = "gitlab_deployment_meta";

function loadDeploymentMeta(): Record<string, GitLabDeploymentMeta> {
  try {
    const raw = localStorage.getItem(DEPLOY_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDeploymentMeta(meta: Record<string, GitLabDeploymentMeta>) {
  try {
    localStorage.setItem(DEPLOY_META_KEY, JSON.stringify(meta));
  } catch {
    // intentional: localStorage quota exceeded or unavailable
  }
}

export const createGitLabSlice: StateCreator<SystemStore, [], [], GitLabSlice> = (set, get) => ({
  gitlabConfig: null,
  gitlabIsConnecting: false,
  gitlabProjects: [],
  gitlabAgents: [],
  gitlabError: null,
  gitlabSelectedProjectId: null,
  gitlabDeploymentMeta: loadDeploymentMeta(),
  gitlabRedeployingAgentId: null,
  gitlabPipelines: [],
  gitlabActivePipeline: null,
  gitlabPipelineJobs: [],
  gitlabJobLog: null,
  gitlabPipelineLoading: false,
  gitlabTriggeringPipeline: false,

  gitlabInitialize: async () => {
    // 1. Load any existing config from the backend
    let config: GitLabConfig | null = null;
    try {
      config = await gitlabGetConfig();
      set({ gitlabConfig: config });
    } catch {
      // intentional: non-critical -- no config stored yet is expected on first launch
    }

    // 2. If already connected, nothing more to do
    if (config?.isConnected) return;

    // 3. Check vault for a stored GitLab credential and auto-connect
    let credentials: Array<{ id: string; service_type: string }>;
    try {
      credentials = storeBus.get<Array<{ id: string; service_type: string }>>(AccessorKey.VAULT_CREDENTIALS);
    } catch {
      // Accessor not yet registered (storeBusWiring loads async) — skip auto-connect
      return;
    }
    const gitlabCred = credentials.find((c) => c.service_type === "gitlab");
    if (!gitlabCred) return;

    try {
      set({ gitlabIsConnecting: true });
      await gitlabConnectFromVault(gitlabCred.id);
      const freshConfig = await gitlabGetConfig();
      set({ gitlabConfig: freshConfig, gitlabIsConnecting: false });
    } catch {
      set({ gitlabIsConnecting: false });
      storeBus.emit('toast', {
        message: "GitLab auto-connect failed — you can reconnect manually from the GitLab panel.",
        type: "error",
      });
    }
  },

  gitlabConnectAction: async (token: string, instanceUrl?: string) => {
    set({ gitlabIsConnecting: true, gitlabError: null });
    try {
      await gitlabConnect(token, instanceUrl);
      const config = await gitlabGetConfig();
      set({ gitlabConfig: config, gitlabIsConnecting: false });
    } catch (err) {
      set({ gitlabIsConnecting: false, gitlabError: translateGitLabError(err) });
      throw err;
    }
  },

  gitlabConnectFromVaultAction: async (credentialId: string, instanceUrl?: string) => {
    set({ gitlabIsConnecting: true, gitlabError: null });
    try {
      await gitlabConnectFromVault(credentialId, instanceUrl);
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
        gitlabRedeployingAgentId: null,
        // Pipeline state
        gitlabPipelines: [],
        gitlabActivePipeline: null,
        gitlabPipelineJobs: [],
        gitlabJobLog: null,
        gitlabPipelineLoading: false,
        gitlabTriggeringPipeline: false,
        // GitOps versioning state
        gitlabPersonaVersions: [],
        gitlabPersonaBranches: [],
        gitlabVersionsLoading: false,
        gitlabRollingBack: false,
        // Deployment history state
        gitlabDeploymentHistory: [],
        gitlabDeploymentHistoryLoading: false,
        gitlabRollingBackFromHistory: false,
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
      // Store deployment metadata for one-click redeploy, keyed by persona name (= agent name on GitLab)
      const personas = storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS);
      const persona = personas.find((p) => p.id === personaId);
      const metaKey = persona?.name ?? personaId;
      const meta = { ...get().gitlabDeploymentMeta, [metaKey]: { personaId, projectId } };
      saveDeploymentMeta(meta);
      set({ gitlabError: null, gitlabDeploymentMeta: meta });
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

  gitlabRedeployAgent: async (agentName: string) => {
    const state = get();
    const meta = state.gitlabDeploymentMeta[agentName];
    const projectId = meta?.projectId ?? state.gitlabSelectedProjectId;
    if (!projectId) {
      set({ gitlabError: "No project associated with this agent. Deploy manually first." });
      throw new Error("No project for redeploy");
    }

    // Resolve personaId: stored metadata first, then name match
    let personaId = meta?.personaId;
    if (!personaId) {
      const personas = storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS);
      const match = personas.find(
        (p) => p.name.toLowerCase() === agentName.toLowerCase(),
      );
      if (!match) {
        set({ gitlabError: `No persona found matching agent "${agentName}". Deploy manually.` });
        throw new Error("No persona match for redeploy");
      }
      personaId = match.id;
    }

    set({ gitlabRedeployingAgentId: agentName, gitlabError: null });
    try {
      const result = await state.gitlabDeployPersona(personaId, projectId, true);
      // Refresh agent list
      const agents = await gitlabListAgents(projectId);
      set({ gitlabAgents: agents, gitlabRedeployingAgentId: null });
      storeBus.emit('toast', { message: "Agent redeployed successfully", type: "success" });
      return result;
    } catch (err) {
      set({ gitlabRedeployingAgentId: null, gitlabError: translateGitLabError(err) });
      throw err;
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

  // -- GitOps versioning ---------------------------------------------------

  gitlabPersonaVersions: [],
  gitlabPersonaBranches: [],
  gitlabVersionsLoading: false,
  gitlabRollingBack: false,

  gitlabFetchPersonaVersions: async (projectId: number, personaName: string) => {
    set({ gitlabVersionsLoading: true });
    try {
      const versions = await gitlabListPersonaVersions(projectId, personaName);
      set({ gitlabPersonaVersions: versions, gitlabVersionsLoading: false, gitlabError: null });
    } catch (err) {
      set({ gitlabVersionsLoading: false, gitlabError: translateGitLabError(err) });
    }
  },

  gitlabDeployPersonaVersioned: async (
    personaId: string,
    projectId: number,
    provisionCredentials: boolean,
    environment?: string,
  ) => {
    emitDeploymentEvent({ eventType: 'deploy_started', target: 'gitlab', personaId, status: 'pending' });
    try {
      const result = await gitlabDeployPersonaVersioned(personaId, projectId, provisionCredentials, environment);
      const personas = storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS);
      const persona = personas.find((p) => p.id === personaId);
      const metaKey = persona?.name ?? personaId;
      const meta = { ...get().gitlabDeploymentMeta, [metaKey]: { personaId, projectId } };
      saveDeploymentMeta(meta);
      set({ gitlabError: null, gitlabDeploymentMeta: meta });
      emitDeploymentEvent({ eventType: 'deploy_succeeded', target: 'gitlab', personaId, detail: `project:${projectId}` });

      // Refresh version list
      if (persona?.name) {
        const versions = await gitlabListPersonaVersions(projectId, persona.name).catch(() => []);
        set({ gitlabPersonaVersions: versions });
      }

      return result;
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
      emitDeploymentEvent({ eventType: 'deploy_failed', target: 'gitlab', personaId, status: 'failed' });
      throw err;
    }
  },

  gitlabRollbackPersona: async (
    projectId: number,
    personaName: string,
    targetTag: string,
  ) => {
    set({ gitlabRollingBack: true, gitlabError: null });
    try {
      const result = await gitlabRollbackPersona(projectId, personaName, targetTag);
      // Refresh versions after rollback
      const versions = await gitlabListPersonaVersions(projectId, personaName).catch(() => []);
      set({ gitlabPersonaVersions: versions, gitlabRollingBack: false });
      storeBus.emit('toast', {
        message: `Rolled back ${personaName} to ${targetTag}`,
        type: "success",
      });
      emitDeploymentEvent({ eventType: 'deploy_succeeded', target: 'gitlab', detail: `rollback:${targetTag}` });
      return result;
    } catch (err) {
      set({ gitlabRollingBack: false, gitlabError: translateGitLabError(err) });
      throw err;
    }
  },

  gitlabFetchPersonaBranches: async (projectId: number, personaName: string) => {
    try {
      const branches = await gitlabListPersonaBranches(projectId, personaName);
      set({ gitlabPersonaBranches: branches, gitlabError: null });
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
    }
  },

  gitlabSetupPersonaBranches: async (projectId: number, personaName: string) => {
    try {
      const branches = await gitlabSetupPersonaBranches(projectId, personaName);
      set({ gitlabPersonaBranches: branches, gitlabError: null });
      storeBus.emit('toast', { message: "Environment branches created", type: "success" });
      return branches;
    } catch (err) {
      set({ gitlabError: translateGitLabError(err) });
      throw err;
    }
  },

  // -- Deployment history -----------------------------------------------------

  gitlabDeploymentHistory: [],
  gitlabDeploymentHistoryLoading: false,
  gitlabRollingBackFromHistory: false,

  gitlabFetchDeploymentHistory: async (projectId: number, personaId?: string) => {
    set({ gitlabDeploymentHistoryLoading: true });
    try {
      const history = await gitlabListDeploymentHistory(projectId, personaId);
      set({ gitlabDeploymentHistory: history, gitlabDeploymentHistoryLoading: false, gitlabError: null });
    } catch (err) {
      set({ gitlabDeploymentHistoryLoading: false, gitlabError: translateGitLabError(err) });
    }
  },

  gitlabRollbackFromHistory: async (projectId: number, deploymentId: string) => {
    set({ gitlabRollingBackFromHistory: true, gitlabError: null });
    try {
      const result = await gitlabRollbackFromHistory(projectId, deploymentId);
      // Refresh history after rollback
      const history = await gitlabListDeploymentHistory(projectId).catch(() => []);
      set({ gitlabDeploymentHistory: history, gitlabRollingBackFromHistory: false });
      storeBus.emit('toast', { message: "Rolled back to previous deployment", type: "success" });
      emitDeploymentEvent({ eventType: 'deploy_succeeded', target: 'gitlab', detail: `rollback-from-history:${deploymentId}` });
      return result;
    } catch (err) {
      set({ gitlabRollingBackFromHistory: false, gitlabError: translateGitLabError(err) });
      throw err;
    }
  },
});
