import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { TaskComplexity } from "@/lib/bindings/TaskComplexity";
import type { RoutingRule } from "@/lib/bindings/RoutingRule";
import type { ComplianceRule } from "@/lib/bindings/ComplianceRule";
import type { ByomPolicy } from "@/lib/bindings/ByomPolicy";
import type { ProviderAuditEntry } from "@/lib/bindings/ProviderAuditEntry";
import type { ProviderUsageStats } from "@/lib/bindings/ProviderUsageStats";
export type { TaskComplexity, RoutingRule, ComplianceRule, ByomPolicy, ProviderAuditEntry, ProviderUsageStats };

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
