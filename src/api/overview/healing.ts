import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { HealingTimelineEvent } from "@/lib/bindings/HealingTimelineEvent";

// ============================================================================
// Healing
// ============================================================================

export const listHealingIssues = (personaId?: string, status?: string) =>
  invoke<PersonaHealingIssue[]>("list_healing_issues", {
    personaId: personaId,
    status: status,
  });

export const getHealingIssue = (id: string, callerPersonaId: string) =>
  invoke<PersonaHealingIssue>("get_healing_issue", { id, callerPersonaId });

export const updateHealingStatus = (id: string, status: string, callerPersonaId: string) =>
  invoke<void>("update_healing_status", { id, status, callerPersonaId });

import type { HealingAnalysisResult } from "@/lib/bindings/HealingAnalysisResult";
export type { HealingAnalysisResult } from "@/lib/bindings/HealingAnalysisResult";

export const runHealingAnalysis = (personaId: string) =>
  invoke<HealingAnalysisResult>("run_healing_analysis", { personaId });

// ============================================================================
// Retry Chain
// ============================================================================

export const getRetryChain = (executionId: string, callerPersonaId: string) =>
  invoke<PersonaExecution[]>("get_retry_chain", { executionId, callerPersonaId });

// ============================================================================
// Healing Timeline
// ============================================================================

export const getHealingTimeline = (personaId: string) =>
  invoke<HealingTimelineEvent[]>("get_healing_timeline", { personaId });

// ============================================================================
// Healing Audit Log
// ============================================================================

import type { HealingAuditEntry } from "@/lib/bindings/HealingAuditEntry";
export type { HealingAuditEntry } from "@/lib/bindings/HealingAuditEntry";

export const listHealingAuditLog = (personaId?: string, limit?: number) =>
  invoke<HealingAuditEntry[]>("list_healing_audit_log", { personaId, limit });
