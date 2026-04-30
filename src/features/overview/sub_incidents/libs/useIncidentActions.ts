import { useCallback } from 'react';
import {
  acknowledgeAuditIncident,
  resolveAuditIncident,
  dismissAuditIncident,
  reopenAuditIncident,
  bulkAcknowledgeAuditIncidents,
  bulkResolveAuditIncidents,
} from '@/api/overview/incidents';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

export interface UseIncidentActionsArgs {
  onAfterChange: () => Promise<void> | void;
}

/**
 * Lifecycle handlers (acknowledge / resolve / dismiss / reopen / bulk).
 * Each handler refreshes the parent list via `onAfterChange` after success,
 * and surfaces a toast on failure.
 */
export function useIncidentActions({ onAfterChange }: UseIncidentActionsArgs) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const handle = useCallback(
    async (
      promise: Promise<unknown>,
      opName: string,
    ) => {
      try {
        await promise;
        await onAfterChange();
      } catch (e) {
        addToast(`${t.overview.incidents.action_failed_prefix} ${opName}: ${e}`, 'error', 4000);
      }
    },
    [addToast, onAfterChange, t.overview.incidents.action_failed_prefix],
  );

  const acknowledge = useCallback(
    (id: string) => handle(acknowledgeAuditIncident(id), 'acknowledge'),
    [handle],
  );
  const resolve = useCallback(
    (id: string, note?: string) =>
      handle(resolveAuditIncident(id, note), 'resolve'),
    [handle],
  );
  const dismiss = useCallback(
    (id: string, note?: string) =>
      handle(dismissAuditIncident(id, note), 'dismiss'),
    [handle],
  );
  const reopen = useCallback(
    (id: string) => handle(reopenAuditIncident(id), 'reopen'),
    [handle],
  );
  const bulkAck = useCallback(
    (ids: string[]) => handle(bulkAcknowledgeAuditIncidents(ids), 'bulk_acknowledge'),
    [handle],
  );
  const bulkResolve = useCallback(
    (ids: string[], note?: string) =>
      handle(bulkResolveAuditIncidents(ids, note), 'bulk_resolve'),
    [handle],
  );

  return { acknowledge, resolve, dismiss, reopen, bulkAck, bulkResolve };
}
