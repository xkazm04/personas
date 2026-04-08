import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ExternalApiKey } from "@/lib/bindings/ExternalApiKey";
import type { CreateApiKeyResponse } from "@/lib/bindings/CreateApiKeyResponse";
export type { ExternalApiKey, CreateApiKeyResponse };

export const createExternalApiKey = (name: string, scopes: string[]) =>
  invoke<CreateApiKeyResponse>("create_external_api_key", { name, scopes });

export const listExternalApiKeys = () =>
  invoke<ExternalApiKey[]>("list_external_api_keys");

export const revokeExternalApiKey = (id: string) =>
  invoke<void>("revoke_external_api_key", { id });

export const deleteExternalApiKey = (id: string) =>
  invoke<void>("delete_external_api_key", { id });

/// Returns the bootstrap "system" API key — used internally by the desktop
/// frontend when calling the management HTTP API directly. Created on-demand
/// at first call.
export const getSystemApiKey = () =>
  invoke<string>("get_system_api_key");
