/**
 * Which door an incident row opens (decision-center wave 3).
 *
 * The incidents tab is a HISTORY view. An incident still waiting on a person
 * (`OPEN_INCIDENT_STATUSES`, the roster's own definition) opens the Decision
 * Deck on the incidents chip with this one on top; a resolved or dismissed
 * incident keeps the detail modal. Every door into an incident — row click,
 * keyboard Enter, Athena's deep link, the autonomous log — routes through
 * here so they cannot disagree.
 */
import { OPEN_INCIDENT_STATUSES } from '@/features/decision-center/roster/decisionAdapters';
import {
  incidentDecisionId,
  openChipDeck,
} from '@/features/overview/sub_manual-review/libs/decisionDeckDoors';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

export function openIncidentDoor(
  incident: AuditIncident,
  showDetail: (incident: AuditIncident) => void,
): 'deck' | 'detail' {
  if (OPEN_INCIDENT_STATUSES.includes(incident.status)) {
    openChipDeck(
      'incidents',
      incidentDecisionId(incident.id),
      document.getElementById(`incident-row-${incident.id}`),
    );
    return 'deck';
  }
  showDetail(incident);
  return 'detail';
}
