import { invoke } from "@tauri-apps/api/core";

import type { MetricsSummary } from "@/lib/bindings/MetricsSummary";
import type { PersonaMetricsSnapshot } from "@/lib/bindings/PersonaMetricsSnapshot";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";

// ============================================================================
// Observability
// ============================================================================

export const getMetricsSummary = (days?: number) =>
  invoke<MetricsSummary>("get_metrics_summary", {
    days: days ?? null,
  });

export const getMetricsSnapshots = (
  personaId?: string,
  startDate?: string,
  endDate?: string,
) =>
  invoke<PersonaMetricsSnapshot[]>("get_metrics_snapshots", {
    personaId: personaId ?? null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
  });

export const getPromptVersions = (personaId: string, limit?: number) =>
  invoke<PersonaPromptVersion[]>("get_prompt_versions", {
    personaId,
    limit: limit ?? null,
  });

export const getAllMonthlySpend = () =>
  invoke<Array<[string, number]>>("get_all_monthly_spend");
