import type { IncidentStatus } from '@/lib/bindings/IncidentStatus';

/**
 * The incident status vocabulary, tethered to the Rust enum.
 *
 * `AuditIncident.status` is typed `string` on the wire, but the closed set is
 * `IncidentStatus` (src-tauri/core/src/models/audit_incident.rs), whose ts-rs
 * binding this module keys its tables on. Every table below is a
 * `Record<IncidentStatus, ...>`, so a sixth status regenerated into the binding
 * fails tsc HERE instead of being silently absent from a hand-copied list.
 * `__tests__/incidentStatusParity.test.ts` reads the Rust `as_str` arms and the
 * portfolio pending-count SQL so the tables cannot drift from the backend.
 *
 * Before this module the inbox spelled the active set five separate ways
 * (detail modal x2, keyboard triage, stale check, clear-all, ledger row), and
 * the ledger row's copy had already lost `in_progress`.
 */

/** Active = still asking a person for something. Terminal = closed. */
const ACTIVE: Record<IncidentStatus, boolean> = {
  open: true,
  acknowledged: true,
  in_progress: true,
  resolved: false,
  dismissed: false,
};

/** Open first, then acknowledged / in-progress, then closed: triage order. */
export const INCIDENT_STATE_RANK: Record<IncidentStatus, number> = {
  open: 0,
  acknowledged: 1,
  in_progress: 2,
  resolved: 3,
  dismissed: 4,
};

/** Every status, in triage order. */
export const INCIDENT_STATUSES: readonly IncidentStatus[] = (
  Object.keys(INCIDENT_STATE_RANK) as IncidentStatus[]
).sort((a, b) => INCIDENT_STATE_RANK[a] - INCIDENT_STATE_RANK[b]);

/** Statuses still awaiting a person (matches the portfolio pending count). */
export const ACTIVE_INCIDENT_STATUSES: readonly IncidentStatus[] = INCIDENT_STATUSES.filter((s) => ACTIVE[s]);

function isIncidentStatus(status: string): status is IncidentStatus {
  return Object.prototype.hasOwnProperty.call(ACTIVE, status);
}

/** True for open / acknowledged / in_progress. An unknown token is not active. */
export function isActiveIncidentStatus(status: string): boolean {
  return isIncidentStatus(status) && ACTIVE[status];
}

/** True for resolved / dismissed (the statuses Reopen applies to). */
export function isClosedIncidentStatus(status: string): boolean {
  return isIncidentStatus(status) && !ACTIVE[status];
}

/** Rank for the ledger's state sort; an unknown token sorts last. */
export function incidentStateRank(status: string): number {
  return isIncidentStatus(status) ? INCIDENT_STATE_RANK[status] : 9;
}

export interface IncidentRowActions {
  acknowledge: boolean;
  resolve: boolean;
  dismiss: boolean;
  reopen: boolean;
}

/**
 * Which one-click actions a ledger row offers. Resolve and dismiss follow the
 * detail modal and the `r` triage key: every active status, `in_progress`
 * included. Acknowledge is for a row nobody has picked up yet.
 */
export function incidentRowActions(status: string): IncidentRowActions {
  const active = isActiveIncidentStatus(status);
  return {
    acknowledge: status === 'open',
    resolve: active,
    dismiss: active,
    reopen: isClosedIncidentStatus(status),
  };
}
