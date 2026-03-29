import { create } from "zustand";
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { AuthUser, AuthStateResponse } from "@/api/auth/auth";
import { clearCryptoCache } from "@/lib/utils/platform/crypto";

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
  /** True when authenticated via cached profile only (no access token). Cloud features unavailable. */
  isOfflineAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isAuthenticated: false,
  isOffline: false,
  isOfflineAuthenticated: false,
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
        isOfflineAuthenticated: state.is_offline_authenticated,
        isLoading: false,
      });
    } catch {
      // intentional: non-critical -- auth state check on startup; backend may not be ready yet
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
        isOfflineAuthenticated: false,
        error: null,
      });
    } catch (err) {
      set({ error: extractError(err) });
    }
  },
}));

export const AUTH_LOGIN_EVENT = "personas:auth-login";

// ---------------------------------------------------------------------------
// Event listener (login timeout helper — listener itself lives in EventBridge)
// ---------------------------------------------------------------------------

let loginTimeoutId: ReturnType<typeof setTimeout> | null = null;

function clearLoginTimeout() {
  if (loginTimeoutId !== null) {
    clearTimeout(loginTimeoutId);
    loginTimeoutId = null;
  }
}
