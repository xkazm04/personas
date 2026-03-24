import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { TaskComplexity } from "@/lib/bindings/TaskComplexity";
import type { RoutingRule } from "@/lib/bindings/RoutingRule";
import type { ComplianceRule } from "@/lib/bindings/ComplianceRule";
import type { ByomPolicy } from "@/lib/bindings/ByomPolicy";
import type { ProviderAuditEntry } from "@/lib/bindings/ProviderAuditEntry";
import type { ProviderUsageStats } from "@/lib/bindings/ProviderUsageStats";
import type { ProviderUsageTimeseries } from "@/lib/bindings/ProviderUsageTimeseries";
import type { ProviderConnectionResult } from "@/lib/bindings/ProviderConnectionResult";
export type { TaskComplexity, RoutingRule, ComplianceRule, ByomPolicy, ProviderAuditEntry, ProviderUsageStats, ProviderUsageTimeseries, ProviderConnectionResult };

// ============================================================================
// BYOM Policy API
// ============================================================================

export const getByomPolicy = () =>
  invoke<ByomPolicy | null>("get_byom_policy");

export const setByomPolicy = (policy: ByomPolicy) =>
  invoke<void>("set_byom_policy", { policy });

export const validateByomPolicy = (policy: ByomPolicy) =>
  invoke<string[]>("validate_byom_policy", { policy });

export const deleteByomPolicy = () =>
  invoke<void>("delete_byom_policy");

// ============================================================================
// Provider Audit Log API
// ============================================================================

export const listProviderAuditLog = (limit?: number) =>
  invoke<ProviderAuditEntry[]>("list_provider_audit_log", { limit: limit });

export const listProviderAuditByPersona = (personaId: string, limit?: number) =>
  invoke<ProviderAuditEntry[]>("list_provider_audit_by_persona", {
    personaId,
    limit: limit,
  });

export const getProviderUsageStats = () =>
  invoke<ProviderUsageStats[]>("get_provider_usage_stats");

export const getProviderUsageTimeseries = (days?: number) =>
  invoke<ProviderUsageTimeseries[]>("get_provider_usage_timeseries", { days });

// ============================================================================
// Provider Connection Test
// ============================================================================

export const testProviderConnection = (providerId: string) =>
  invoke<ProviderConnectionResult>("test_provider_connection", { providerId });
