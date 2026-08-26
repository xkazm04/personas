import { useEffect, useRef } from 'react';
import { storeBus } from '@/lib/storeBus';
import { silentCatch } from '@/lib/silentCatch';
import { getAuditIncident } from '@/api/overview/incidents';
import { consumePendingIncidentDeepLink } from './incidentDeepLink';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

/**
 * Open a specific incident's detail modal when Athena's `incident_blocker`
 * nudge is engaged.
 *
 * Two entry paths, both needed: the latch (`incidentDeepLink`) covers an emit
 * that fired while this view was still lazy-mounting, and the `storeBus`
 * subscription covers the already-mounted case. The loaded list is preferred
 * over a fetch so the common case costs no IPC.
 *
 * `incidents` is read through a ref so the subscription is not torn down and
 * re-added on every 30s refresh.
 */
export function useIncidentDeepLinkOpen(
  incidents: AuditIncident[],
  onOpen: (incident: AuditIncident) => void,
): void {
  const incidentsRef = useRef(incidents);
  incidentsRef.current = incidents;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    let cancelled = false;

    const openById = (incidentId: string) => {
      const fromList = incidentsRef.current.find((i) => i.id === incidentId);
      if (fromList) {
        if (!cancelled) onOpenRef.current(fromList);
        return;
      }
      getAuditIncident(incidentId)
        .then((incident) => {
          if (!cancelled && incident) onOpenRef.current(incident);
        })
        .catch(silentCatch('incidents.deep-link.get_audit_incident'));
    };

    const pending = consumePendingIncidentDeepLink();
    if (pending) openById(pending);

    const unsubscribe = storeBus.on('incidents:open-detail', ({ incidentId }) => openById(incidentId));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
