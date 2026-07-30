import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AuditIncident } from "@/lib/bindings/AuditIncident";
import type { AuditIncidentSummary } from "@/lib/bindings/AuditIncidentSummary";
import type { IncidentDiagnosis } from "@/lib/bindings/IncidentDiagnosis";
import type { IncidentFilters } from "@/lib/bindings/IncidentFilters";

// ============================================================================
// Audit Incidents — cross-source incidents inbox
// ============================================================================
//
// See `src/features/overview/sub_incidents/DESIGN.md` for the architecture.
// All commands require IPC auth (handled by `invokeWithTimeout`).

export type { AuditIncident, AuditIncidentSummary, IncidentDiagnosis, IncidentFilters };

export const listAuditIncidents = (
  filters?: IncidentFilters,
  limit?: number,
  offset?: number,
) =>
  invoke<AuditIncident[]>("list_audit_incidents", {
    filters: filters ?? null,
    limit: limit ?? null,
    offset: offset ?? null,
  });

export const getAuditIncidentsSummary = () =>
  invoke<AuditIncidentSummary>("get_audit_incidents_summary");

export const getAuditIncident = (id: string) =>
  invoke<AuditIncident>("get_audit_incident", { id });

export const acknowledgeAuditIncident = (id: string) =>
  invoke<boolean>("acknowledge_audit_incident", { id });

export const setIncidentInProgress = (id: string) =>
  invoke<boolean>("set_incident_in_progress", { id });

export const resolveAuditIncident = (id: string, resolutionNote?: string) =>
  invoke<boolean>("resolve_audit_incident", {
    id,
    resolutionNote: resolutionNote ?? null,
  });

export const dismissAuditIncident = (id: string, resolutionNote?: string) =>
  invoke<boolean>("dismiss_audit_incident", {
    id,
    resolutionNote: resolutionNote ?? null,
  });

export const reopenAuditIncident = (id: string) =>
  invoke<boolean>("reopen_audit_incident", { id });

export const bulkAcknowledgeAuditIncidents = (ids: string[]) =>
  invoke<number>("bulk_acknowledge_audit_incidents", { ids });

export const bulkResolveAuditIncidents = (ids: string[], resolutionNote?: string) =>
  invoke<number>("bulk_resolve_audit_incidents", {
    ids,
    resolutionNote: resolutionNote ?? null,
  });

// ============================================================================
// Autonomous NOC v1 — diagnosis + "handled autonomously" lane
// ============================================================================

/** Stored root-cause diagnosis for an incident (null when not yet diagnosed). */
export const getIncidentDiagnosis = (incidentId: string) =>
  invoke<IncidentDiagnosis | null>("get_incident_diagnosis", { incidentId });

/**
 * Run (or return the stored) diagnosis for an incident. May create ONE
 * pending companion approval proposing a remediation — proposal only, the
 * user approves/rejects it in Athena's Approvals.
 */
export const diagnoseAuditIncident = (incidentId: string) =>
  invoke<IncidentDiagnosis>("diagnose_audit_incident", { incidentId });

/** Incidents the system handled without a human (sparse in v1 by design). */
export const listAutonomouslyHandledIncidents = (limit?: number) =>
  invoke<AuditIncident[]>("list_autonomously_handled_incidents", {
    limit: limit ?? null,
  });
