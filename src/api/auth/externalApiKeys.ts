import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ExternalApiKey } from "@/lib/bindings/ExternalApiKey";
import type { CreateApiKeyResponse } from "@/lib/bindings/CreateApiKeyResponse";
import type { ApiKeyAuditEntry } from "@/lib/bindings/ApiKeyAuditEntry";
export type { ExternalApiKey, CreateApiKeyResponse, ApiKeyAuditEntry };

/**
 * Create a key. `expiresInDays` (7/30/90 or undefined for never) is turned into
 * a server-authoritative absolute expiry in the Tauri command.
 */
export const createExternalApiKey = (
  name: string,
  scopes: string[],
  expiresInDays?: number,
) =>
  invoke<CreateApiKeyResponse>("create_external_api_key", {
    name,
    scopes,
    expiresInDays: expiresInDays ?? null,
  });

/** Recent management-API request trail for one key (newest first). */
export const listApiKeyAudit = (keyId: string, limit = 100) =>
  invoke<ApiKeyAuditEntry[]>("list_api_key_audit", { keyId, limit });

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
