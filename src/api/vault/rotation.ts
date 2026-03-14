import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { RotationPolicy } from "@/lib/bindings/RotationPolicy";
import type { CreateRotationPolicyInput } from "@/lib/bindings/CreateRotationPolicyInput";
import type { UpdateRotationPolicyInput } from "@/lib/bindings/UpdateRotationPolicyInput";
import type { RotationHistoryEntry } from "@/lib/bindings/RotationHistoryEntry";
import type { Remediation } from "@/lib/bindings/Remediation";
import type { AnomalyScore } from "@/lib/bindings/AnomalyScore";
import type { HealthcheckEntry } from "@/lib/bindings/HealthcheckEntry";
import type { RotationStatus } from "@/lib/bindings/RotationStatus";
export type { RotationPolicy, CreateRotationPolicyInput, UpdateRotationPolicyInput, RotationHistoryEntry, Remediation, AnomalyScore, HealthcheckEntry, RotationStatus };

// ============================================================================
// API Functions
// ============================================================================

export const listRotationPolicies = (credentialId: string) =>
  invoke<RotationPolicy[]>("list_rotation_policies", { credentialId });

export const createRotationPolicy = (input: CreateRotationPolicyInput) =>
  invoke<RotationPolicy>("create_rotation_policy", { input });

export const updateRotationPolicy = (id: string, input: UpdateRotationPolicyInput) =>
  invoke<RotationPolicy>("update_rotation_policy", { id, input });

export const deleteRotationPolicy = (id: string) =>
  invoke<boolean>("delete_rotation_policy", { id });

export const getRotationHistory = (credentialId: string, limit?: number) =>
  invoke<RotationHistoryEntry[]>("get_rotation_history", { credentialId, limit: limit });

export const getRotationStatus = (credentialId: string) =>
  invoke<RotationStatus>("get_rotation_status", { credentialId });

export const rotateCredentialNow = (credentialId: string) =>
  invoke<string>("rotate_credential_now", { credentialId });

export const refreshCredentialOAuthNow = (credentialId: string) =>
  invoke<string>("refresh_credential_oauth_now", { credentialId });
