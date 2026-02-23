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

export const listAllCredentialEvents = () =>
  invoke<CredentialEvent[]>("list_all_credential_events");

export const createCredentialEvent = (input: CreateCredentialEventInput) =>
  invoke<CredentialEvent>("create_credential_event", { input });

export const updateCredentialEvent = (id: string, input: UpdateCredentialEventInput) =>
  invoke<CredentialEvent>("update_credential_event", { id, input });

export const deleteCredentialEvent = (id: string) =>
  invoke<boolean>("delete_credential_event", { id });

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

export interface MigrationResult {
  migrated: number;
  failed: number;
}

export const migratePlaintextCredentials = () =>
  invoke<MigrationResult>("migrate_plaintext_credentials");

// ── Credential Intelligence ───────────────────────────────────────────

import type { CredentialAuditEntry } from "@/lib/bindings/CredentialAuditEntry";
import type { CredentialUsageStats } from "@/lib/bindings/CredentialUsageStats";
import type { CredentialDependent } from "@/lib/bindings/CredentialDependent";

export type { CredentialAuditEntry, CredentialUsageStats, CredentialDependent };

export const getCredentialAuditLog = (credentialId: string, limit?: number) =>
  invoke<CredentialAuditEntry[]>("credential_audit_log", { credentialId, limit });

export const getCredentialUsageStats = (credentialId: string) =>
  invoke<CredentialUsageStats>("credential_usage_stats", { credentialId });

export const getCredentialDependents = (credentialId: string) =>
  invoke<CredentialDependent[]>("credential_dependents", { credentialId });
