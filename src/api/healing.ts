import { invoke } from "@tauri-apps/api/core";

import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";

// ============================================================================
// Healing
// ============================================================================

export const listHealingIssues = (personaId?: string, status?: string) =>
  invoke<PersonaHealingIssue[]>("list_healing_issues", {
    personaId: personaId ?? null,
    status: status ?? null,
  });

export const getHealingIssue = (id: string) =>
  invoke<PersonaHealingIssue>("get_healing_issue", { id });

export const updateHealingStatus = (id: string, status: string) =>
  invoke<void>("update_healing_status", { id, status });

export interface HealingAnalysisResult {
  status: string;
  failures_analyzed: number;
  issues_created: number;
  auto_fixed: number;
  auto_retried: number;
}

export const runHealingAnalysis = (personaId: string) =>
  invoke<HealingAnalysisResult>("run_healing_analysis", { personaId });

// ============================================================================
// Retry Chain
// ============================================================================

export const getRetryChain = (executionId: string) =>
  invoke<PersonaExecution[]>("get_retry_chain", { executionId });
