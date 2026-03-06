import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// BYOM Types
// ============================================================================

export type TaskComplexity = "simple" | "standard" | "critical";

export interface RoutingRule {
  name: string;
  task_complexity: TaskComplexity;
  provider: string;
  model: string | null;
  enabled: boolean;
}

export interface ComplianceRule {
  name: string;
  workflow_tags: string[];
  allowed_providers: string[];
  enabled: boolean;
}

export interface ByomPolicy {
  enabled: boolean;
  allowed_providers: string[];
  blocked_providers: string[];
  routing_rules: RoutingRule[];
  compliance_rules: ComplianceRule[];
}

export interface ProviderAuditEntry {
  id: string;
  execution_id: string;
  persona_id: string;
  persona_name: string;
  engine_kind: string;
  model_used: string | null;
  was_failover: boolean;
  routing_rule_name: string | null;
  compliance_rule_name: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  status: string;
  created_at: string;
}

export interface ProviderUsageStats {
  engine_kind: string;
  execution_count: number;
  total_cost_usd: number;
  avg_duration_ms: number;
  failover_count: number;
}

// ============================================================================
// BYOM Policy API
// ============================================================================

export const getByomPolicy = () =>
  invoke<ByomPolicy | null>("get_byom_policy");

export const setByomPolicy = (policy: ByomPolicy) =>
  invoke<void>("set_byom_policy", { policy });

export const deleteByomPolicy = () =>
  invoke<void>("delete_byom_policy");

// ============================================================================
// Provider Audit Log API
// ============================================================================

export const listProviderAuditLog = (limit?: number) =>
  invoke<ProviderAuditEntry[]>("list_provider_audit_log", { limit: limit ?? null });

export const listProviderAuditByPersona = (personaId: string, limit?: number) =>
  invoke<ProviderAuditEntry[]>("list_provider_audit_by_persona", {
    personaId,
    limit: limit ?? null,
  });

export const getProviderUsageStats = () =>
  invoke<ProviderUsageStats[]>("get_provider_usage_stats");
