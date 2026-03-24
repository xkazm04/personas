import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import { reportError } from "../../storeTypes";
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

export interface CloudReconnectState {
  /** Whether auto-reconnection is in progress. */
  isReconnecting: boolean;
  /** Number of consecutive reconnection attempts so far. */
  attempt: number;
  /** Timestamp (ms) when the next retry will fire, or null if idle. */
  nextRetryAt: number | null;
}

export const CLOUD_BACKOFF_STEPS = [5_000, 10_000, 20_000, 60_000] as const;

export interface CloudSlice {
  // State
  cloudConfig: CloudConfig | null;
  cloudIsConnecting: boolean;
  cloudStatus: CloudStatusResponse | null;
  cloudIsLoadingStatus: boolean;
  cloudOAuthStatus: CloudOAuthStatusResponse | null;
  cloudPendingOAuthState: string | null;
  cloudError: string | null;
  /** Last measured health-check round-trip latency in milliseconds, or null when unknown. */
  cloudConnectionLatencyMs: number | null;
  /** Auto-reconnection state when cloud connection drops. */
  cloudReconnectState: CloudReconnectState;
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
  /** Reset reconnect state (called when reconnection succeeds or user manually acts). */
  cloudClearReconnect: () => void;
  // Deployment actions
  cloudFetchDeployments: () => Promise<void>;
  cloudDeploy: (personaId: string, maxMonthlyBudgetUsd?: number) => Promise<CloudDeployment>;
  cloudPauseDeploy: (deploymentId: string) => Promise<void>;
  cloudResumeDeploy: (deploymentId: string) => Promise<void>;
  cloudRemoveDeploy: (deploymentId: string) => Promise<void>;
  // Bulk deployment actions
  cloudBulkPause: (deploymentIds: string[]) => Promise<BulkActionResult[]>;
  cloudBulkResume: (deploymentIds: string[]) => Promise<BulkActionResult[]>;
  cloudBulkRemove: (deploymentIds: string[]) => Promise<BulkActionResult[]>;
}

export interface BulkActionResult {
  deploymentId: string;
  status: 'fulfilled' | 'rejected';
  error?: string;
}

const PENDING_OAUTH_TIMEOUT_MS = 10 * 60 * 1000;
let pendingOAuthTimeoutRef: ReturnType<typeof setTimeout> | null = null;

function clearPendingOAuthTimeout() {
  if (pendingOAuthTimeoutRef) {
    clearTimeout(pendingOAuthTimeoutRef);
    pendingOAuthTimeoutRef = null;
  }
}

const IDLE_RECONNECT: CloudReconnectState = { isReconnecting: false, attempt: 0, nextRetryAt: null };

export const createCloudSlice: StateCreator<SystemStore, [], [], CloudSlice> = (set, get) => ({
  cloudConfig: null,
  cloudIsConnecting: false,
  cloudStatus: null,
  cloudIsLoadingStatus: false,
  cloudConnectionLatencyMs: null,
  cloudReconnectState: IDLE_RECONNECT,
  cloudDeployments: [],
  cloudIsDeploying: false,
  cloudBaseUrl: null,
  cloudOAuthStatus: null,
  cloudPendingOAuthState: null,
  cloudError: null,

  cloudInitialize: async () => {
    // Skip cloud initialization if user is not authenticated
    if (!storeBus.get<boolean>(AccessorKey.AUTH_IS_AUTHENTICATED)) return;

    try {
      const config = await cloudGetConfig();
      set({ cloudConfig: config });

      // If keyring has credentials but the in-memory client isn't connected,
      // attempt to reconnect automatically so users don't have to re-enter creds.
      if (config && !config.is_connected) {
        try {
          const latencyMs = await cloudReconnectFromKeyring();
          const refreshed = await cloudGetConfig();
          set({ cloudConfig: refreshed, cloudConnectionLatencyMs: latencyMs || null });
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
      const latencyMs = await cloudConnect(url, apiKey);
      const config = await cloudGetConfig();
      set({ cloudConfig: config, cloudIsConnecting: false, cloudConnectionLatencyMs: latencyMs, cloudReconnectState: IDLE_RECONNECT });
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
        cloudConnectionLatencyMs: null,
        cloudReconnectState: IDLE_RECONNECT,
        cloudDeployments: [],
        cloudBaseUrl: null,
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
        storeBus.emit('toast', { message: "OAuth authorization timed out -- please retry.", type: "error" });
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
      set({ cloudPendingOAuthState: null });
      await get().cloudFetchOAuthStatus();
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    } finally {
      clearPendingOAuthTimeout();
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

  cloudClearReconnect: () => {
    set({ cloudReconnectState: IDLE_RECONNECT });
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
      reportError(err, "Failed to pause deployment", set, { stateUpdates: { cloudDeployments: prevDeployments, cloudError: translateCloudError(err) } });
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
      reportError(err, "Failed to resume deployment", set, { stateUpdates: { cloudDeployments: prevDeployments, cloudError: translateCloudError(err) } });
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
      reportError(err, "Failed to remove deployment", set, { stateUpdates: { cloudDeployments: prevDeployments, cloudError: translateCloudError(err) } });
    }
  },

  // --- Bulk deployment actions ---

  cloudBulkPause: async (deploymentIds: string[]) => {
    const results = await Promise.allSettled(
      deploymentIds.map((id) => cloudPauseDeployment(id).then((updated) => ({ id, updated })))
    );
    const updates: Record<string, CloudDeployment> = {};
    const bulkResults: BulkActionResult[] = results.map((r, i) => {
      const deploymentId = deploymentIds[i]!;
      if (r.status === 'fulfilled') {
        updates[r.value.id] = r.value.updated;
        emitDeploymentEvent({ eventType: 'deploy_paused', target: 'cloud', detail: deploymentId });
        return { deploymentId, status: 'fulfilled' as const };
      }
      return { deploymentId, status: 'rejected' as const, error: translateCloudError(r.reason) };
    });
    if (Object.keys(updates).length > 0) {
      set((state) => ({
        cloudDeployments: state.cloudDeployments.map((d) => updates[d.id] ?? d),
      }));
    }
    return bulkResults;
  },

  cloudBulkResume: async (deploymentIds: string[]) => {
    const results = await Promise.allSettled(
      deploymentIds.map((id) => cloudResumeDeployment(id).then((updated) => ({ id, updated })))
    );
    const updates: Record<string, CloudDeployment> = {};
    const bulkResults: BulkActionResult[] = results.map((r, i) => {
      const deploymentId = deploymentIds[i]!;
      if (r.status === 'fulfilled') {
        updates[r.value.id] = r.value.updated;
        emitDeploymentEvent({ eventType: 'deploy_resumed', target: 'cloud', detail: deploymentId });
        return { deploymentId, status: 'fulfilled' as const };
      }
      return { deploymentId, status: 'rejected' as const, error: translateCloudError(r.reason) };
    });
    if (Object.keys(updates).length > 0) {
      set((state) => ({
        cloudDeployments: state.cloudDeployments.map((d) => updates[d.id] ?? d),
      }));
    }
    return bulkResults;
  },

  cloudBulkRemove: async (deploymentIds: string[]) => {
    const results = await Promise.allSettled(
      deploymentIds.map((id) => cloudUndeploy(id).then(() => id))
    );
    const removedIds = new Set<string>();
    const bulkResults: BulkActionResult[] = results.map((r, i) => {
      const deploymentId = deploymentIds[i]!;
      if (r.status === 'fulfilled') {
        removedIds.add(deploymentId);
        emitDeploymentEvent({ eventType: 'agent_undeployed', target: 'cloud', detail: deploymentId });
        return { deploymentId, status: 'fulfilled' as const };
      }
      return { deploymentId, status: 'rejected' as const, error: translateCloudError(r.reason) };
    });
    if (removedIds.size > 0) {
      set((state) => ({
        cloudDeployments: state.cloudDeployments.filter((d) => !removedIds.has(d.id)),
      }));
    }
    return bulkResults;
  },
});
