import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AuthUser } from "@/lib/bindings/AuthUser";
import type { AuthStateResponse } from "@/lib/bindings/AuthStateResponse";
export type { AuthUser, AuthStateResponse };

export const loginWithGoogle = () =>
  invoke<void>("login_with_google");

export const getAuthState = () =>
  invoke<AuthStateResponse>("get_auth_state");

export const logoutUser = () =>
  invoke<void>("logout");
