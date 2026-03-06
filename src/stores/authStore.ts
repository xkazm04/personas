import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import { listen } from "@tauri-apps/api/event";
import type { AuthUser, AuthStateResponse } from "@/api/auth";
import { clearCryptoCache } from "@/lib/utils/crypto";

// Re-export so existing consumers can still import from authStore
export type { AuthUser, AuthStateResponse };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a human-readable message from Tauri IPC error objects ({error, kind}). */
function extractError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "error" in err)
    return String((err as { error: unknown }).error);
  return String(err);
}

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
            // intentional: non-critical — auth state check on startup; backend may not be ready yet
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
            set({ isLoading: false, error: extractError(err) });
          }
        },

        logout: async () => {
          try {
            await invoke("logout");
            clearCryptoCache();
            set({
              user: null,
              isAuthenticated: false,
              isOffline: false,
              error: null,
            });
          } catch (err) {
            set({ error: extractError(err) });
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

export const AUTH_LOGIN_EVENT = "personas:auth-login";

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
let authDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function initAuthListener() {
  if (authListenerAttached) return;
  authListenerAttached = true;
  listen<AuthStateResponse>("auth-state-changed", (event) => {
    clearLoginTimeout();

    // Debounce rapid auth-state-changed events (100ms trailing) to avoid
    // inconsistent isAuthenticated/user state from interleaved updates.
    if (authDebounceTimer !== null) clearTimeout(authDebounceTimer);
    authDebounceTimer = setTimeout(() => {
      authDebounceTimer = null;
      const prev = useAuthStore.getState();
      const state = event.payload;
      useAuthStore.setState({
        user: state.user,
        isAuthenticated: state.is_authenticated,
        isOffline: state.is_offline,
        isLoading: false,
      });

      // When user becomes authenticated, notify persona store to initialize cloud connection.
      if (state.is_authenticated && !prev.isAuthenticated) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(AUTH_LOGIN_EVENT));
        }
      }
    }, 100);
  });
}
