import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AuditIncident } from "@/lib/bindings/AuditIncident";
import type { AuditIncidentSummary } from "@/lib/bindings/AuditIncidentSummary";
import type { IncidentFilters } from "@/lib/bindings/IncidentFilters";

// ============================================================================
// Audit Incidents — cross-source incidents inbox
// ============================================================================
//
// See `src/features/overview/sub_incidents/DESIGN.md` for the architecture.
// All commands require IPC auth (handled by `invokeWithTimeout`).

export type { AuditIncident, AuditIncidentSummary, IncidentFilters };

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
