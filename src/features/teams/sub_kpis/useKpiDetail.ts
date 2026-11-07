// Shared data + actions for a single KPI's detail surface. Extracted from
// KPIDetailDrawer so the new full-screen KpiDetailModal can reuse the exact same
// loading (measurements, linked goals, live bindings) and mutations
// (record-manual / measure-now / pause-resume-archive) without duplicating them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiBinding } from '@/lib/bindings/DevKpiBinding';
import { listKpiBindings } from '@/api/devTools/kpis';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export function useKpiDetail(kpi: DevKpi) {
  const { t } = useTranslation();
  // The store holds ONE measurement list, for whichever KPI was fetched last.
  // Opening KPI B shows A's rows until B's read lands, and a slow read for A
  // landing after B's leaves A's series under B's name for good. Only rows of
  // THIS KPI are this KPI's history.
  const storeMeasurements = useSystemStore((s) => s.kpiMeasurements);
  const measurements = useMemo(
    () => storeMeasurements.filter((m) => m.kpi_id === kpi.id),
    [storeMeasurements, kpi.id],
  );
  const goals = useSystemStore((s) => s.goals);
  const fetchKpiMeasurements = useSystemStore((s) => s.fetchKpiMeasurements);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const recordKpiMeasurement = useSystemStore((s) => s.recordKpiMeasurement);
  const evaluateKpi = useSystemStore((s) => s.evaluateKpi);
  const updateKpi = useSystemStore((s) => s.updateKpi);

  const [rawBindings, setBindings] = useState<DevKpiBinding[]>([]);
  // Same hazard as the measurements above: a read for the KPI that was open
  // before this one must not land on this KPI's source section.
  const kpiIdRef = useRef(kpi.id);
  kpiIdRef.current = kpi.id;
  const bindings = useMemo(() => rawBindings.filter((b) => b.kpi_id === kpi.id), [rawBindings, kpi.id]);

  const refreshBindings = useCallback(() => {
    const requested = kpi.id;
    listKpiBindings(requested)
      .then((rows) => { if (kpiIdRef.current === requested) setBindings(rows); })
      .catch((err) => {
        silentCatch('useKpiDetail:listKpiBindings')(err);
        if (kpiIdRef.current === requested) setBindings([]);
      });
  }, [kpi.id]);

  useEffect(() => {
    void fetchKpiMeasurements(kpi.id);
    void fetchGoals(kpi.project_id);
    refreshBindings();
  }, [kpi.id, kpi.project_id, fetchKpiMeasurements, fetchGoals, refreshBindings]);

  const linkedGoals = useMemo(() => goals.filter((g) => g.kpi_id === kpi.id), [goals, kpi.id]);

  /** Resolves true once the reading is stored. False on a refused or failed
   *  write (already reported), so the caller keeps what the user typed. */
  const recordManual = useCallback(
    async (value: number): Promise<boolean> => {
      if (!Number.isFinite(value)) return false;
      try {
        await recordKpiMeasurement(kpi.id, value);
        return true;
      } catch (err) {
        toastCatch('kpi measure', t.kpis.measure_failed)(err);
        return false;
      }
    },
    [kpi.id, recordKpiMeasurement, t],
  );

  const measureNow = useCallback(
    () => evaluateKpi(kpi.id).catch(toastCatch('kpi evaluate', t.kpis.evaluate_failed)),
    [kpi.id, evaluateKpi, t],
  );

  const setStatus = useCallback(
    (status: 'active' | 'paused' | 'archived') => updateKpi(kpi.id, { status }),
    [kpi.id, updateKpi],
  );

  return {
    measurements,
    linkedGoals,
    bindings,
    refreshBindings,
    fetchKpiMeasurements,
    recordManual,
    measureNow,
    setStatus,
  };
}
