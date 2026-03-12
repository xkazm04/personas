import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { translateCloudError, isAuthError } from "./deployTarget";
import { emitDeploymentEvent } from "@/hooks/realtime/emitDeploymentEvent";
import {
  cloudConnect,
  cloudReconnectFromKeyring,
  cloudDisconnect,
  cloudGetConfig,
  cloudStatus,
  cloudExecutePersona,
  cloudCancelExecution,
  cloudOAuthAuthorize,
  cloudOAuthCallback,
  cloudOAuthStatus,
  cloudOAuthRefresh,
  cloudOAuthDisconnect,
  cloudDeployPersona,
  cloudListDeployments,
  cloudPauseDeployment,
  cloudResumeDeployment,
  cloudUndeploy,
  cloudGetBaseUrl,
  type CloudConfig,
  type CloudStatusResponse,
  type CloudOAuthAuthorizeResponse,
  type CloudOAuthStatusResponse,
  type CloudDeployment,
} from "@/api/system/cloud";

export interface CloudSlice {
  // State
  cloudConfig: CloudConfig | null;
  cloudIsConnecting: boolean;
  cloudStatus: CloudStatusResponse | null;
  cloudIsLoadingStatus: boolean;
  cloudOAuthStatus: CloudOAuthStatusResponse | null;
  cloudPendingOAuthState: string | null;
  cloudError: string | null;
  // Deployments
  cloudDeployments: CloudDeployment[];
  cloudIsDeploying: boolean;
  cloudBaseUrl: string | null;

  // Actions
  cloudInitialize: () => Promise<void>;
  cloudConnectAction: (url: string, apiKey: string) => Promise<void>;
  cloudDisconnectAction: () => Promise<void>;
  cloudFetchStatus: () => Promise<void>;
  cloudExecute: (personaId: string, inputData?: string) => Promise<string>;
  cloudCancel: (executionId: string) => Promise<boolean>;
  cloudFetchOAuthStatus: () => Promise<void>;
  cloudStartOAuth: () => Promise<CloudOAuthAuthorizeResponse | null>;
  cloudCancelPendingOAuth: () => void;
  cloudCompleteOAuth: (code: string, state: string) => Promise<void>;
  cloudRefreshOAuth: () => Promise<void>;
  cloudDisconnectOAuth: () => Promise<void>;
  cloudClearError: () => void;
  // Deployment actions
  cloudFetchDeployments: () => Promise<void>;
  cloudDeploy: (personaId: string, maxMonthlyBudgetUsd?: number) => Promise<CloudDeployment>;
  cloudPauseDeploy: (deploymentId: string) => Promise<void>;
  cloudResumeDeploy: (deploymentId: string) => Promise<void>;
  cloudRemoveDeploy: (deploymentId: string) => Promise<void>;
}

const PENDING_OAUTH_TIMEOUT_MS = 10 * 60 * 1000;
let pendingOAuthTimeoutRef: ReturnType<typeof setTimeout> | null = null;

function clearPendingOAuthTimeout() {
  if (pendingOAuthTimeoutRef) {
    clearTimeout(pendingOAuthTimeoutRef);
    pendingOAuthTimeoutRef = null;
  }
}

export const createCloudSlice: StateCreator<PersonaStore, [], [], CloudSlice> = (set, get) => ({
  cloudConfig: null,
  cloudIsConnecting: false,
  cloudStatus: null,
  cloudIsLoadingStatus: false,
  cloudDeployments: [],
  cloudIsDeploying: false,
  cloudBaseUrl: null,
  cloudOAuthStatus: null,
  cloudPendingOAuthState: null,
  cloudError: null,

  cloudInitialize: async () => {
    // Skip cloud initialization if user is not authenticated
    if (!useAuthStore.getState().isAuthenticated) return;

    try {
      const config = await cloudGetConfig();
      set({ cloudConfig: config });

      // If keyring has credentials but the in-memory client isn't connected,
      // attempt to reconnect automatically so users don't have to re-enter creds.
      if (config && !config.is_connected) {
        try {
          await cloudReconnectFromKeyring();
          const refreshed = await cloudGetConfig();
          set({ cloudConfig: refreshed });
        } catch (err) {
          if (isAuthError(err)) {
            set({ cloudError: "Credentials expired or revoked. Please reconnect to the cloud orchestrator." });
          }
          // Network / unreachable errors -- stay disconnected silently
        }
      }
    } catch {
      // intentional: non-critical -- no config stored yet is expected on first launch
    }
  },

  cloudConnectAction: async (url: string, apiKey: string) => {
    set({ cloudIsConnecting: true, cloudError: null });
    try {
      await cloudConnect(url, apiKey);
      const config = await cloudGetConfig();
      set({ cloudConfig: config, cloudIsConnecting: false });
    } catch (err) {
      set({ cloudIsConnecting: false, cloudError: translateCloudError(err) });
      throw err;
    }
  },

  cloudDisconnectAction: async () => {
    try {
      await cloudDisconnect();
      clearPendingOAuthTimeout();
      set({
        cloudConfig: null,
        cloudStatus: null,
        cloudOAuthStatus: null,
        cloudPendingOAuthState: null,
        cloudError: null,
      });
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudFetchStatus: async () => {
    set({ cloudIsLoadingStatus: true });
    try {
      const status = await cloudStatus();
      set({ cloudStatus: status, cloudIsLoadingStatus: false });
    } catch (err) {
      set({ cloudIsLoadingStatus: false, cloudError: translateCloudError(err) });
    }
  },

  cloudExecute: async (personaId: string, inputData?: string) => {
    return await cloudExecutePersona(personaId, inputData);
  },

  cloudCancel: async (executionId: string) => {
    return await cloudCancelExecution(executionId);
  },

  cloudFetchOAuthStatus: async () => {
    try {
      const oauthStatus = await cloudOAuthStatus();
      set({ cloudOAuthStatus: oauthStatus });
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudStartOAuth: async () => {
    try {
      const result = await cloudOAuthAuthorize();
      clearPendingOAuthTimeout();
      set({ cloudPendingOAuthState: result.state });
      pendingOAuthTimeoutRef = setTimeout(() => {
        set({ cloudPendingOAuthState: null, cloudError: "OAuth authorization timed out. Please try again." });
        useToastStore.getState().addToast("OAuth authorization timed out -- please retry.", "error");
      }, PENDING_OAUTH_TIMEOUT_MS);
      return result;
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
      return null;
    }
  },

  cloudCancelPendingOAuth: () => {
    clearPendingOAuthTimeout();
    set({ cloudPendingOAuthState: null });
  },

  cloudCompleteOAuth: async (code: string, state: string) => {
    try {
      await cloudOAuthCallback(code, state);
      clearPendingOAuthTimeout();
      set({ cloudPendingOAuthState: null });
      await get().cloudFetchOAuthStatus();
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudRefreshOAuth: async () => {
    try {
      await cloudOAuthRefresh();
      await get().cloudFetchOAuthStatus();
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudDisconnectOAuth: async () => {
    try {
      await cloudOAuthDisconnect();
      clearPendingOAuthTimeout();
      set({ cloudOAuthStatus: null });
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudClearError: () => {
    set({ cloudError: null });
  },

  // --- Deployment actions ---

  cloudFetchDeployments: async () => {
    try {
      const [deployments, baseUrl] = await Promise.all([
        cloudListDeployments(),
        cloudGetBaseUrl(),
      ]);
      set({ cloudDeployments: deployments, cloudBaseUrl: baseUrl });
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudDeploy: async (personaId: string, maxMonthlyBudgetUsd?: number) => {
    set({ cloudIsDeploying: true, cloudError: null });
    emitDeploymentEvent({ eventType: 'deploy_started', target: 'cloud', personaId, status: 'pending' });
    try {
      const deployment = await cloudDeployPersona(personaId, maxMonthlyBudgetUsd);
      const baseUrl = await cloudGetBaseUrl();
      set((state) => ({
        cloudDeployments: [deployment, ...state.cloudDeployments],
        cloudIsDeploying: false,
        cloudBaseUrl: baseUrl,
      }));
      emitDeploymentEvent({ eventType: 'deploy_succeeded', target: 'cloud', personaId, detail: deployment.id });
      return deployment;
    } catch (err) {
      set({ cloudIsDeploying: false, cloudError: translateCloudError(err) });
      emitDeploymentEvent({ eventType: 'deploy_failed', target: 'cloud', personaId, status: 'failed' });
      throw err;
    }
  },

  cloudPauseDeploy: async (deploymentId: string) => {
    const prevDeployments = get().cloudDeployments;
    try {
      const updated = await cloudPauseDeployment(deploymentId);
      set((state) => ({
        cloudDeployments: state.cloudDeployments.map((d) =>
          d.id === deploymentId ? updated : d
        ),
      }));
      emitDeploymentEvent({ eventType: 'deploy_paused', target: 'cloud', detail: deploymentId });
    } catch (err) {
      set({ cloudDeployments: prevDeployments, cloudError: translateCloudError(err) });
      useToastStore.getState().addToast("Failed to pause deployment.", "error");
    }
  },

  cloudResumeDeploy: async (deploymentId: string) => {
    const prevDeployments = get().cloudDeployments;
    try {
      const updated = await cloudResumeDeployment(deploymentId);
      set((state) => ({
        cloudDeployments: state.cloudDeployments.map((d) =>
          d.id === deploymentId ? updated : d
        ),
      }));
      emitDeploymentEvent({ eventType: 'deploy_resumed', target: 'cloud', detail: deploymentId });
    } catch (err) {
      set({ cloudDeployments: prevDeployments, cloudError: translateCloudError(err) });
      useToastStore.getState().addToast("Failed to resume deployment.", "error");
    }
  },

  cloudRemoveDeploy: async (deploymentId: string) => {
    const prevDeployments = get().cloudDeployments;
    try {
      await cloudUndeploy(deploymentId);
      set((state) => ({
        cloudDeployments: state.cloudDeployments.filter((d) => d.id !== deploymentId),
      }));
      emitDeploymentEvent({ eventType: 'agent_undeployed', target: 'cloud', detail: deploymentId });
    } catch (err) {
      set({ cloudDeployments: prevDeployments, cloudError: translateCloudError(err) });
      useToastStore.getState().addToast("Failed to remove deployment.", "error");
    }
  },
});
