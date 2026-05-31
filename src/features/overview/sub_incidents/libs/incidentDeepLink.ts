/**
 * incidentDeepLink — module-level latch bridging the lazy-mount race between
 * the Athena `incident_blocker` proactive engage handler and the IncidentsInbox.
 *
 * Engaging an `incident_blocker` nudge navigates to Overview → Incidents, which
 * lazy-mounts {@link IncidentsInbox}. The `storeBus.emit('incidents:open-detail')`
 * the engage handler fires can therefore land BEFORE the inbox subscribes —
 * storeBus is fire-and-forget with no replay. This tiny latch holds the most
 * recently requested incident id so a late-mounting inbox can consume the
 * intent on mount (in addition to consuming it live via the storeBus event when
 * the inbox is already mounted). Single-slot by design: only the latest
 * deep-link matters; consuming clears it so a manual revisit to the tab does
 * not re-pop the modal.
 */

let _pendingIncidentId: string | null = null;

/** Record a deep-link request. Called by the engage handler alongside the emit. */
export function setPendingIncidentDeepLink(incidentId: string): void {
  _pendingIncidentId = incidentId;
}

/** Read-and-clear the pending deep-link id, if any. Called by IncidentsInbox on mount. */
export function consumePendingIncidentDeepLink(): string | null {
  const id = _pendingIncidentId;
  _pendingIncidentId = null;
  return id;
}
