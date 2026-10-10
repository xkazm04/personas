import { useEffect, useRef } from 'react';
import { getReport } from '@/api/overview/reports';
import { useOverviewStore } from '@/stores/overviewStore';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona, PersonaReport } from '@/lib/types/types';

/**
 * Consumes `pendingReportFocus` (see `openReportInReports`): once the Reports
 * tab is mounted, open the named report's detail modal and clear the signal so
 * the same id does not reopen on a later remount.
 *
 * The report is taken from the already-loaded list when it is there; a cold
 * store or a report past the first page is fetched by id. `reports` and
 * `personaMap` ride a ref on purpose: they change as the list loads, and an
 * effect keyed on them would cancel and restart the fetch on every change.
 */
export function usePendingReportFocus(
  reports: PersonaReport[],
  personaMap: Map<string, Persona>,
  open: (report: PersonaReport) => void,
) {
  const { t } = useTranslation();
  const pendingId = useOverviewStore((s) => s.pendingReportFocus);
  const latest = useRef({ reports, personaMap, open, unavailable: t.overview.reports_view.linked_report_unavailable });
  latest.current = { reports, personaMap, open, unavailable: t.overview.reports_view.linked_report_unavailable };

  useEffect(() => {
    if (!pendingId) return;
    const clear = () => useOverviewStore.getState().setPendingReportFocus(null);
    const loaded = latest.current.reports.find((r) => r.id === pendingId);
    if (loaded) {
      latest.current.open(loaded);
      clear();
      return;
    }
    let cancelled = false;
    getReport(pendingId)
      .then((raw) => {
        if (cancelled) return;
        const persona = latest.current.personaMap.get(raw.persona_id);
        latest.current.open({
          ...raw,
          persona_name: persona?.name,
          persona_icon: persona?.icon ?? undefined,
          persona_color: persona?.color ?? undefined,
        });
      })
      .catch(toastCatch('ReportList:openLinkedReport', latest.current.unavailable))
      .finally(() => {
        if (!cancelled) clear();
      });
    return () => {
      cancelled = true;
    };
  }, [pendingId]);
}
