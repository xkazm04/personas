import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AuthUser, AuthStateResponse } from "@/api/auth";

// Re-export so existing consumers can still import from authStore
export type { AuthUser, AuthStateResponse };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isOffline: boolean;
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
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
              isAuthenticated: state.is_authenticated,
              isOffline: state.is_offline,
              isLoading: false,
            });
          } catch {
            set({ isLoading: false });
          }
        },

        loginWithGoogle: async () => {
          clearLoginTimeout();
          set({ isLoading: true, error: null });
          try {
            await invoke("login_with_google");
            // Actual state update comes via "auth-state-changed" event.
            // Set a timeout to recover from missed/failed OAuth callbacks.
            loginTimeoutId = setTimeout(() => {
              loginTimeoutId = null;
              const s = useAuthStore.getState();
              if (s.isLoading && !s.isAuthenticated) {
                set({
                  isLoading: false,
                  error: "Login timed out. Please try again.",
                });
              }
            }, 120_000);
          } catch (err) {
            clearLoginTimeout();
            set({ isLoading: false, error: String(err) });
          }
        },

        logout: async () => {
          try {
            await invoke("logout");
            set({
              user: null,
              isAuthenticated: false,
              isOffline: false,
              error: null,
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
        }),
      },
    ),
    { name: "auth-store" },
  ),
);

// ---------------------------------------------------------------------------
// Event listener
// ---------------------------------------------------------------------------

let loginTimeoutId: ReturnType<typeof setTimeout> | null = null;

function clearLoginTimeout() {
  if (loginTimeoutId !== null) {
    clearTimeout(loginTimeoutId);
    loginTimeoutId = null;
  }
}

let authListenerAttached = false;

export function initAuthListener() {
  if (authListenerAttached) return;
  authListenerAttached = true;
  listen<AuthStateResponse>("auth-state-changed", (event) => {
    clearLoginTimeout();
    const prev = useAuthStore.getState();
    const state = event.payload;
    useAuthStore.setState({
      user: state.user,
      isAuthenticated: state.is_authenticated,
      isOffline: state.is_offline,
      isLoading: false,
    });

    // When user becomes authenticated, auto-initialize cloud connection
    if (state.is_authenticated && !prev.isAuthenticated) {
      import("@/stores/personaStore").then(({ usePersonaStore }) => {
        usePersonaStore.getState().cloudInitialize();
      });
    }
  });
}
