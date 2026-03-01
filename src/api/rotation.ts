import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Rotation Policy Types
// ============================================================================

export interface RotationPolicy {
  id: string;
  credential_id: string;
  enabled: boolean;
  rotation_interval_days: number;
  policy_type: string;
  last_rotated_at: string | null;
  next_rotation_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRotationPolicyInput {
  credential_id: string;
  rotation_interval_days?: number;
  policy_type?: string;
  enabled?: boolean;
}

export interface UpdateRotationPolicyInput {
  enabled?: boolean;
  rotation_interval_days?: number;
}

// ============================================================================
// Rotation History Types
// ============================================================================

export interface RotationHistoryEntry {
  id: string;
  credential_id: string;
  rotation_type: string;
  status: string;
  detail: string | null;
  created_at: string;
}

// ============================================================================
// Anomaly Scoring Types
// ============================================================================

export type Remediation =
  | "healthy"
  | "backoff_retry"
  | "preemptive_rotation"
  | "rotate_then_alert"
  | "disable";

export interface AnomalyScore {
  failure_rate_total: number;
  failure_rate_5m: number;
  failure_rate_1h: number;
  failure_rate_24h: number;
  permanent_failure_rate_1h: number;
  transient_failure_rate_1h: number;
  remediation: Remediation;
  sample_count: number;
  data_stale: boolean;
}

export interface HealthcheckEntry {
  success: boolean;
  status_code: number | null;
  error_class: string | null;
  message: string;
  timestamp: string;
}

// ============================================================================
// Rotation Status
// ============================================================================

export interface RotationStatus {
  has_policy: boolean;
  policy_enabled: boolean;
  rotation_interval_days: number | null;
  next_rotation_at: string | null;
  last_rotated_at: string | null;
  last_status: string | null;
  anomaly_detected: boolean;
  consecutive_failures: number;
  recent_history: RotationHistoryEntry[];
  anomaly_score: AnomalyScore | null;
  anomaly_tolerance: number;
}

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
  invoke<RotationHistoryEntry[]>("get_rotation_history", { credentialId, limit: limit ?? null });

export const getRotationStatus = (credentialId: string) =>
  invoke<RotationStatus>("get_rotation_status", { credentialId });

export const rotateCredentialNow = (credentialId: string) =>
  invoke<string>("rotate_credential_now", { credentialId });
