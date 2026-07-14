// Shared data + actions for a single KPI's detail surface. Extracted from
// KPIDetailDrawer so the new full-screen KpiDetailModal can reuse the exact same
// loading (measurements, linked goals, live bindings) and mutations
// (record-manual / measure-now / pause-resume-archive) without duplicating them.
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiBinding } from '@/lib/bindings/DevKpiBinding';
import { listKpiBindings } from '@/api/devTools/kpis';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

export function useKpiDetail(kpi: DevKpi) {
  const { t } = useTranslation();
  const measurements = useSystemStore((s) => s.kpiMeasurements);
  const goals = useSystemStore((s) => s.goals);
  const fetchKpiMeasurements = useSystemStore((s) => s.fetchKpiMeasurements);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const recordKpiMeasurement = useSystemStore((s) => s.recordKpiMeasurement);
  const evaluateKpi = useSystemStore((s) => s.evaluateKpi);
  const updateKpi = useSystemStore((s) => s.updateKpi);

  const [bindings, setBindings] = useState<DevKpiBinding[]>([]);

  const refreshBindings = useCallback(() => {
    listKpiBindings(kpi.id).then(setBindings).catch(() => setBindings([]));
  }, [kpi.id]);

  useEffect(() => {
    void fetchKpiMeasurements(kpi.id);
    void fetchGoals(kpi.project_id);
    refreshBindings();
  }, [kpi.id, kpi.project_id, fetchKpiMeasurements, fetchGoals, refreshBindings]);

  const linkedGoals = useMemo(() => goals.filter((g) => g.kpi_id === kpi.id), [goals, kpi.id]);

  const recordManual = useCallback(
    async (value: number) => {
      if (!Number.isFinite(value)) return;
      try {
        await recordKpiMeasurement(kpi.id, value);
      } catch (err) {
        toastCatch('kpi measure', t.kpis.measure_failed)(err);
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
