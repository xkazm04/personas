import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  cloudConnect,
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
  type CloudStatusResult,
  type OAuthAuthorizeResult,
  type OAuthStatusResult,
} from "@/api/tauriApi";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface CloudState {
  config: CloudConfig | null;
  isConnecting: boolean;
  status: CloudStatusResult | null;
  isLoadingStatus: boolean;
  oauthStatus: OAuthStatusResult | null;
  pendingOAuthState: string | null;
  error: string | null;

  initialize: () => Promise<void>;
  connect: (url: string, apiKey: string) => Promise<void>;
  disconnect: () => Promise<void>;
  fetchStatus: () => Promise<void>;
  cloudExecute: (personaId: string, inputData?: string) => Promise<string>;
  cloudCancel: (executionId: string) => Promise<boolean>;
  fetchOAuthStatus: () => Promise<void>;
  startOAuth: () => Promise<OAuthAuthorizeResult | null>;
  completeOAuth: (code: string, state: string) => Promise<void>;
  refreshOAuth: () => Promise<void>;
  disconnectOAuth: () => Promise<void>;
}

export const useCloudStore = create<CloudState>()(
  devtools(
    persist(
      (set, get) => ({
        config: null,
        isConnecting: false,
        status: null,
        isLoadingStatus: false,
        oauthStatus: null,
        pendingOAuthState: null,
        error: null,

        initialize: async () => {
          try {
            const config = await cloudGetConfig();
            set({ config });
          } catch {
            // Not connected — that's fine
          }
        },

        connect: async (url: string, apiKey: string) => {
          set({ isConnecting: true, error: null });
          try {
            await cloudConnect(url, apiKey);
            const config = await cloudGetConfig();
            set({ config, isConnecting: false });
          } catch (err) {
            set({ isConnecting: false, error: String(err) });
            throw err;
          }
        },

        disconnect: async () => {
          try {
            await cloudDisconnect();
            set({
              config: null,
              status: null,
              oauthStatus: null,
              pendingOAuthState: null,
              error: null,
            });
          } catch (err) {
            set({ error: String(err) });
          }
        },

        fetchStatus: async () => {
          set({ isLoadingStatus: true });
          try {
            const status = await cloudStatus();
            set({ status, isLoadingStatus: false });
          } catch (err) {
            set({ isLoadingStatus: false, error: String(err) });
          }
        },

        cloudExecute: async (personaId: string, inputData?: string) => {
          const executionId = await cloudExecutePersona(personaId, inputData);
          return executionId;
        },

        cloudCancel: async (executionId: string) => {
          return await cloudCancelExecution(executionId);
        },

        fetchOAuthStatus: async () => {
          try {
            const oauthStatus = await cloudOAuthStatus();
            set({ oauthStatus });
          } catch (err) {
            set({ error: String(err) });
          }
        },

        startOAuth: async () => {
          try {
            const result = await cloudOAuthAuthorize();
            set({ pendingOAuthState: result.state });
            return result;
          } catch (err) {
            set({ error: String(err) });
            return null;
          }
        },

        completeOAuth: async (code: string, state: string) => {
          try {
            await cloudOAuthCallback(code, state);
            set({ pendingOAuthState: null });
            // Refresh OAuth status after callback
            await get().fetchOAuthStatus();
          } catch (err) {
            set({ error: String(err) });
          }
        },

        refreshOAuth: async () => {
          try {
            await cloudOAuthRefresh();
            await get().fetchOAuthStatus();
          } catch (err) {
            set({ error: String(err) });
          }
        },

        disconnectOAuth: async () => {
          try {
            await cloudOAuthDisconnect();
            set({ oauthStatus: null });
          } catch (err) {
            set({ error: String(err) });
          }
        },
      }),
      {
        name: "cloud-state",
        partialize: (state) => ({
          config: state.config,
        }),
      },
    ),
    { name: "cloud-store" },
  ),
);
