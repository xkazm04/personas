import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { RotationPolicy } from "@/lib/bindings/RotationPolicy";
import type { CreateRotationPolicyInput } from "@/lib/bindings/CreateRotationPolicyInput";
import type { UpdateRotationPolicyInput } from "@/lib/bindings/UpdateRotationPolicyInput";
import type { RotationHistoryEntry } from "@/lib/bindings/RotationHistoryEntry";
import type { Remediation } from "@/lib/bindings/Remediation";
import type { AnomalyScore } from "@/lib/bindings/AnomalyScore";
import type { HealthcheckEntry } from "@/lib/bindings/HealthcheckEntry";
import type { RotationStatus } from "@/lib/bindings/RotationStatus";
import type { OAuthTokenMetric } from "@/lib/bindings/OAuthTokenMetric";
import type { OAuthTokenLifetimeSummary } from "@/lib/bindings/OAuthTokenLifetimeSummary";
export type { RotationPolicy, CreateRotationPolicyInput, UpdateRotationPolicyInput, RotationHistoryEntry, Remediation, AnomalyScore, HealthcheckEntry, RotationStatus, OAuthTokenMetric, OAuthTokenLifetimeSummary };

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
  invoke<string>("delete_rotation_policy", { id });

export const getRotationHistory = (credentialId: string, limit?: number) =>
  invoke<RotationHistoryEntry[]>("get_rotation_history", { credentialId, limit: limit });

export const getRotationStatus = (credentialId: string) =>
  invoke<RotationStatus>("get_rotation_status", { credentialId });

export const rotateCredentialNow = (credentialId: string) =>
  invoke<string>("rotate_credential_now", { credentialId });

export const refreshCredentialOAuthNow = (credentialId: string) =>
  invoke<string>("refresh_credential_oauth_now", { credentialId });

// ============================================================================
// OAuth Token Lifetime Metrics
// ============================================================================

export const getOAuthTokenMetrics = (credentialId: string, limit?: number) =>
  invoke<OAuthTokenMetric[]>("get_oauth_token_metrics", { credentialId, limit });

export const getOAuthTokenLifetimeSummary = (credentialId: string) =>
  invoke<OAuthTokenLifetimeSummary>("get_oauth_token_lifetime_summary", { credentialId });
