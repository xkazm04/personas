import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Auth
// ============================================================================

export interface AuthStateResponse {
  is_authenticated: boolean;
  is_offline: boolean;
  user: {
    id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  subscription: {
    plan: string;
    status: string;
    current_period_end: string | null;
  } | null;
}

export const loginWithGoogle = () =>
  invoke<void>("login_with_google");

export const getAuthState = () =>
  invoke<AuthStateResponse>("get_auth_state");

export const logoutUser = () =>
  invoke<void>("logout");

export const refreshSession = () =>
  invoke<AuthStateResponse>("refresh_session");
