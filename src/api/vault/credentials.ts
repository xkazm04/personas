import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaCredential } from "@/lib/bindings/PersonaCredential";
import type { CreateCredentialInput } from "@/lib/bindings/CreateCredentialInput";
import type { UpdateCredentialInput } from "@/lib/bindings/UpdateCredentialInput";
import type { CredentialEvent } from "@/lib/bindings/CredentialEvent";
import type { CreateCredentialEventInput } from "@/lib/bindings/CreateCredentialEventInput";
import type { UpdateCredentialEventInput } from "@/lib/bindings/UpdateCredentialEventInput";
import type { HealthcheckResult } from "@/lib/bindings/HealthcheckResult";
import type { VaultStatus } from "@/lib/bindings/VaultStatus";
import type { MigrationResult } from "@/lib/bindings/MigrationResult";
import type { CredentialFieldMeta } from "@/lib/bindings/CredentialFieldMeta";
export type { HealthcheckResult, VaultStatus, MigrationResult, CredentialFieldMeta };

// ============================================================================
// Credentials
// ============================================================================

export const listCredentials = () =>
  invoke<PersonaCredential[]>("list_credentials");

export const createCredential = (input: CreateCredentialInput) =>
  invoke<PersonaCredential>("create_credential", { input });

export const updateCredential = (id: string, input: UpdateCredentialInput) =>
  invoke<PersonaCredential>("update_credential", { id, input });

export const patchCredentialMetadata = (credentialId: string, patch: Record<string, unknown>) =>
  invoke<PersonaCredential>("patch_credential_metadata", { id: credentialId, patch });

export const deleteCredential = (id: string) =>
  invoke<boolean>("delete_credential", { id });

export const listCredentialEvents = (credentialId: string) =>
  invoke<CredentialEvent[]>("list_credential_events", { credentialId });

export const listAllCredentialEvents = () =>
  invoke<CredentialEvent[]>("list_all_credential_events");

export const createCredentialEvent = (input: CreateCredentialEventInput) =>
  invoke<CredentialEvent>("create_credential_event", { input });

export const updateCredentialEvent = (id: string, input: UpdateCredentialEventInput) =>
  invoke<CredentialEvent>("update_credential_event", { id, input });

export const deleteCredentialEvent = (id: string) =>
  invoke<boolean>("delete_credential_event", { id });

// -- Credential Security -------------------------------------------------


export const getSessionPublicKey = () =>
  invoke<string>("get_session_public_key");

export const healthcheckCredential = (credentialId: string) =>
  invoke<HealthcheckResult>("healthcheck_credential", { credentialId });

export const healthcheckCredentialPreview = (
  serviceType: string,
  fieldValues: Record<string, string>,
  sessionEncryptedData?: string,
) =>
  invoke<HealthcheckResult>("healthcheck_credential_preview", {
    serviceType,
    fieldValues,
    sessionEncryptedData,
  });

export const vaultStatus = () =>
  invoke<VaultStatus>("vault_status");


export const migratePlaintextCredentials = () =>
  invoke<MigrationResult>("migrate_plaintext_credentials");

// -- Field-level Credential Storage ------------------------------------


export const listCredentialFields = (credentialId: string) =>
  invoke<CredentialFieldMeta[]>("list_credential_fields", { credentialId });

export const updateCredentialField = (
  credentialId: string,
  fieldKey: string,
  fieldValue: string,
  isSensitive: boolean,
  sessionEncryptedValue?: string,
) =>
  invoke<boolean>("update_credential_field", {
    credentialId,
    fieldKey,
    fieldValue,
    isSensitive,
    sessionEncryptedValue,
  });

// -- Credential Intelligence -------------------------------------------

import type { CredentialAuditEntry } from "@/lib/bindings/CredentialAuditEntry";
import type { CredentialUsageStats } from "@/lib/bindings/CredentialUsageStats";
import type { CredentialDependent } from "@/lib/bindings/CredentialDependent";

export type { CredentialAuditEntry, CredentialUsageStats, CredentialDependent };

export const getCredentialAuditLog = (credentialId: string, limit?: number) =>
  invoke<CredentialAuditEntry[]>("credential_audit_log", { credentialId, limit });

export const getCredentialAuditLogGlobal = (limit?: number) =>
  invoke<CredentialAuditEntry[]>("credential_audit_log_global", { limit });

export const getCredentialUsageStats = (credentialId: string) =>
  invoke<CredentialUsageStats>("credential_usage_stats", { credentialId });

export const getCredentialDependents = (credentialId: string) =>
  invoke<CredentialDependent[]>("credential_dependents", { credentialId });
