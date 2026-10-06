/**
 * The two row-backed detail surfaces: an incident in `IncidentDetailModal`, a
 * report in `ReportDetailModal`.
 *
 * Both modals want the full row the roster item only projects, so each reads
 * it once by id (`useSurfaceRow`), and both are lazy (`lazyRetry`) — they
 * carry markdown/print machinery the Monitor's own chunk should not pay for.
 * Their lifecycle actions are their own (they already write through their
 * own doors, and the report's delete asks first inside `ReportDetailModal`);
 * the hub re-reads the roster when they report a change, so the strip and the
 * peek follow.
 */
import { Suspense, useCallback } from 'react';

import { getAuditIncident } from '@/api/overview/incidents';
import { getReport } from '@/api/overview/reports';
import { lazyRetry } from '@/lib/lazyRetry';
import { useOverviewStore } from '@/stores/overviewStore';

import type { DecisionItem } from '../../model/decisionModel';
import { useLiftDetailModal } from './useLiftDetailModal';
import { SurfaceReadError, useSurfaceRow } from './useSurfaceRow';

const IncidentDetailModal = lazyRetry(() =>
  import('@/features/overview/sub_incidents/components/IncidentDetailModal').then((m) => ({
    default: m.IncidentDetailModal,
  })),
);
const ReportDetailModal = lazyRetry(() =>
  import('@/features/overview/sub_reports/components/ReportDetailModal').then((m) => ({
    default: m.ReportDetailModal,
  })),
);

interface RowSurfaceProps {
  item: DecisionItem;
  /** Re-read the roster: the modal changed the row through its own door. */
  onChanged: () => void;
  onClose: () => void;
}

export function IncidentSurface({ item, onChanged, onClose }: RowSurfaceProps) {
  const { row: incident, setRow: setIncident, failure, retry } = useSurfaceRow(getAuditIncident, item.sourceId);
  useLiftDetailModal(incident !== null);
  if (failure) return <SurfaceReadError failure={failure} onRetry={retry} onClose={onClose} />;
  if (!incident) return null;
  return (
    <Suspense fallback={null}>
      <IncidentDetailModal incident={incident} onClose={onClose} onChanged={onChanged} onOpenIncident={setIncident} />
    </Suspense>
  );
}

export function ReportSurface({ item, onChanged, onClose }: RowSurfaceProps) {
  const { row: report, failure, retry } = useSurfaceRow(getReport, item.sourceId);
  // The overview's own delete: it also drops the row from the Overview list.
  const deleteFromOverview = useOverviewStore((s) => s.deleteReport);
  useLiftDetailModal(report !== null);

  // Closing re-reads: the modal marks the report read on its own.
  const close = useCallback(() => {
    onChanged();
    onClose();
  }, [onChanged, onClose]);
  const remove = useCallback(async () => {
    if (!report) return;
    await deleteFromOverview(report.id);
    close();
  }, [report, deleteFromOverview, close]);

  if (failure) return <SurfaceReadError failure={failure} onRetry={retry} onClose={onClose} />;
  if (!report) return null;
  return (
    <Suspense fallback={null}>
      <ReportDetailModal message={report} onClose={close} onDelete={remove} />
    </Suspense>
  );
}
