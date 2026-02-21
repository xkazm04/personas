import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
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
  type CloudConfig,
  type CloudStatusResponse,
  type CloudOAuthAuthorizeResponse,
  type CloudOAuthStatusResponse,
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

  // Actions
  cloudInitialize: () => Promise<void>;
  cloudConnectAction: (url: string, apiKey: string) => Promise<void>;
  cloudDisconnectAction: () => Promise<void>;
  cloudFetchStatus: () => Promise<void>;
  cloudExecute: (personaId: string, inputData?: string) => Promise<string>;
  cloudCancel: (executionId: string) => Promise<boolean>;
  cloudFetchOAuthStatus: () => Promise<void>;
  cloudStartOAuth: () => Promise<CloudOAuthAuthorizeResponse | null>;
  cloudCompleteOAuth: (code: string, state: string) => Promise<void>;
  cloudRefreshOAuth: () => Promise<void>;
  cloudDisconnectOAuth: () => Promise<void>;
}

export const createCloudSlice: StateCreator<PersonaStore, [], [], CloudSlice> = (set, get) => ({
  cloudConfig: null,
  cloudIsConnecting: false,
  cloudStatus: null,
  cloudIsLoadingStatus: false,
  cloudOAuthStatus: null,
  cloudPendingOAuthState: null,
  cloudError: null,

  cloudInitialize: async () => {
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
        } catch {
          // Orchestrator unreachable — stay disconnected silently
        }
      }
    } catch {
      // No config stored — that's fine
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
      set({ cloudPendingOAuthState: result.state });
      return result;
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
      return null;
    }
  },

  cloudCompleteOAuth: async (code: string, state: string) => {
    try {
      await cloudOAuthCallback(code, state);
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
      set({ cloudOAuthStatus: null });
    } catch (err) {
      set({ cloudError: translateCloudError(err) });
    }
  },
});
