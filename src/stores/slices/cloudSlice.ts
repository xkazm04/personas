import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { useAuthStore } from "@/stores/authStore";
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
} from "@/api/cloud";

/** Translate raw backend error strings into user-friendly messages. */
function translateCloudError(err: unknown): string {
  const raw = String(err).toLowerCase();

  // Connection / network errors
  if (raw.includes("not reachable") || raw.includes("connection refused") || raw.includes("connect error")) {
    return "Could not reach the orchestrator. Check the URL and your network connection.";
  }
  if (raw.includes("timed out") || raw.includes("timeout")) {
    return "Connection timed out. The orchestrator may be down or the URL may be incorrect.";
  }
  if (raw.includes("dns") || raw.includes("resolve") || raw.includes("no such host")) {
    return "Could not resolve the hostname. Double-check the orchestrator URL for typos.";
  }

  // Auth errors
  if (raw.includes("401") || raw.includes("unauthorized")) {
    return "Invalid API key. Please verify your credentials and try again.";
  }
  if (raw.includes("403") || raw.includes("forbidden")) {
    return "Access denied. Your API key does not have the required permissions.";
  }

  // Server errors
  if (raw.includes("500") || raw.includes("internal server error")) {
    return "The orchestrator returned a server error. Try again in a few minutes.";
  }
  if (raw.includes("502") || raw.includes("503") || raw.includes("504") || raw.includes("bad gateway") || raw.includes("service unavailable")) {
    return "The orchestrator is temporarily unavailable. Try again shortly.";
  }

  // Not connected
  if (raw.includes("not connected")) {
    return "Not connected to the cloud orchestrator. Please connect first.";
  }

  // OAuth specific
  if (raw.includes("oauth") && raw.includes("expired")) {
    return "OAuth token has expired. Please re-authorize.";
  }

  // URL / key validation
  if (raw.includes("url must not be empty")) {
    return "Please enter the orchestrator URL.";
  }
  if (raw.includes("api key must not be empty")) {
    return "Please enter your API key.";
  }

  // Keyring errors
  if (raw.includes("keyring")) {
    return "Could not access stored credentials. You may need to reconnect.";
  }

  // Fallback: strip common prefixes for cleaner display
  return String(err).replace(/^Cloud error:\s*/i, "");
}

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
  cloudDeploy: (personaId: string) => Promise<CloudDeployment>;
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
          // Distinguish auth errors (user needs to act) from network errors (stay quiet).
          const raw = String(err).toLowerCase();
          const isAuthError =
            raw.includes("401") ||
            raw.includes("unauthorized") ||
            raw.includes("403") ||
            raw.includes("forbidden") ||
            raw.includes("expired") ||
            raw.includes("revoked");

          if (isAuthError) {
            set({ cloudError: "Credentials expired or revoked. Please reconnect to the cloud orchestrator." });
          }
          // Network / unreachable errors — stay disconnected silently
        }
      }
    } catch {
      // intentional: non-critical — no config stored yet is expected on first launch
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
        set({ cloudPendingOAuthState: null });
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

  cloudDeploy: async (personaId: string) => {
    set({ cloudIsDeploying: true, cloudError: null });
    try {
      const deployment = await cloudDeployPersona(personaId);
      const baseUrl = await cloudGetBaseUrl();
      set((state) => ({
        cloudDeployments: [deployment, ...state.cloudDeployments],
        cloudIsDeploying: false,
        cloudBaseUrl: baseUrl,
      }));
      return deployment;
    } catch (err) {
      set({ cloudIsDeploying: false, cloudError: translateCloudError(err) });
      throw err;
    }
  },

  cloudPauseDeploy: async (deploymentId: string) => {
    try {
      const updated = await cloudPauseDeployment(deploymentId);
      set((state) => ({
        cloudDeployments: state.cloudDeployments.map((d) =>
          d.id === deploymentId ? updated : d
        ),
      }));
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudResumeDeploy: async (deploymentId: string) => {
    try {
      const updated = await cloudResumeDeployment(deploymentId);
      set((state) => ({
        cloudDeployments: state.cloudDeployments.map((d) =>
          d.id === deploymentId ? updated : d
        ),
      }));
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },

  cloudRemoveDeploy: async (deploymentId: string) => {
    try {
      await cloudUndeploy(deploymentId);
      set((state) => ({
        cloudDeployments: state.cloudDeployments.filter((d) => d.id !== deploymentId),
      }));
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },
});
