import { invoke } from "@tauri-apps/api/core";

import type { PersonaCredential } from "@/lib/bindings/PersonaCredential";
import type { CreateCredentialInput } from "@/lib/bindings/CreateCredentialInput";
import type { UpdateCredentialInput } from "@/lib/bindings/UpdateCredentialInput";
import type { CredentialEvent } from "@/lib/bindings/CredentialEvent";
import type { CreateCredentialEventInput } from "@/lib/bindings/CreateCredentialEventInput";
import type { UpdateCredentialEventInput } from "@/lib/bindings/UpdateCredentialEventInput";

// ============================================================================
// Credentials
// ============================================================================

export const listCredentials = () =>
  invoke<PersonaCredential[]>("list_credentials");

export const createCredential = (input: CreateCredentialInput) =>
  invoke<PersonaCredential>("create_credential", { input });

export const updateCredential = (id: string, input: UpdateCredentialInput) =>
  invoke<PersonaCredential>("update_credential", { id, input });

export const deleteCredential = (id: string) =>
  invoke<boolean>("delete_credential", { id });

export const listCredentialEvents = (credentialId: string) =>
  invoke<CredentialEvent[]>("list_credential_events", { credentialId });

export const createCredentialEvent = (input: CreateCredentialEventInput) =>
  invoke<CredentialEvent>("create_credential_event", { input });

export const updateCredentialEvent = (id: string, input: UpdateCredentialEventInput) =>
  invoke<CredentialEvent>("update_credential_event", { id, input });

// ── Credential Security ─────────────────────────────────────────────────

export interface HealthcheckResult {
  success: boolean;
  message: string;
}

export interface VaultStatus {
  key_source: string;
  total: number;
  encrypted: number;
  plaintext: number;
}

export const healthcheckCredential = (credentialId: string) =>
  invoke<HealthcheckResult>("healthcheck_credential", { credentialId });

export const healthcheckCredentialPreview = (
  serviceType: string,
  fieldValues: Record<string, string>,
) =>
  invoke<HealthcheckResult>("healthcheck_credential_preview", {
    serviceType,
    fieldValues,
  });

export const vaultStatus = () =>
  invoke<VaultStatus>("vault_status");
