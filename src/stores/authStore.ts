import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface AuthSubscription {
  plan: string;
  status: string;
  current_period_end: string | null;
}

export interface AuthStateResponse {
  is_authenticated: boolean;
  is_offline: boolean;
  user: AuthUser | null;
  subscription: AuthSubscription | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface AuthState {
  user: AuthUser | null;
  subscription: AuthSubscription | null;
  isAuthenticated: boolean;
  isOffline: boolean;
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        subscription: null,
        isAuthenticated: false,
        isOffline: false,
        isLoading: false,
        error: null,

        initialize: async () => {
          set({ isLoading: true });
          try {
            const state = await invoke<AuthStateResponse>("get_auth_state");
            set({
              user: state.user,
              subscription: state.subscription,
              isAuthenticated: state.is_authenticated,
              isOffline: state.is_offline,
              isLoading: false,
            });
          } catch {
            set({ isLoading: false });
          }
        },

        loginWithGoogle: async () => {
          set({ isLoading: true, error: null });
          try {
            await invoke("login_with_google");
            // Actual state update comes via "auth-state-changed" event
          } catch (err) {
            set({ isLoading: false, error: String(err) });
          }
        },

        logout: async () => {
          try {
            await invoke("logout");
            set({
              user: null,
              subscription: null,
              isAuthenticated: false,
              isOffline: false,
              error: null,
            });
          } catch (err) {
            set({ error: String(err) });
          }
        },

        refreshSession: async () => {
          try {
            const state = await invoke<AuthStateResponse>("refresh_session");
            set({
              user: state.user,
              subscription: state.subscription,
              isAuthenticated: state.is_authenticated,
              isOffline: state.is_offline,
            });
          } catch (err) {
            set({ error: String(err) });
          }
        },
      }),
      {
        name: "auth-state",
        partialize: (state) => ({
          user: state.user,
          isAuthenticated: state.isAuthenticated,
        }),
      },
    ),
    { name: "auth-store" },
  ),
);

// ---------------------------------------------------------------------------
// Event listener
// ---------------------------------------------------------------------------

let authListenerAttached = false;

export function initAuthListener() {
  if (authListenerAttached) return;
  authListenerAttached = true;
  listen<AuthStateResponse>("auth-state-changed", (event) => {
    const state = event.payload;
    useAuthStore.setState({
      user: state.user,
      subscription: state.subscription,
      isAuthenticated: state.is_authenticated,
      isOffline: state.is_offline,
      isLoading: false,
    });
  });
}
