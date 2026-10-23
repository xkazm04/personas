// Localized words for the KPI setup modals (Add a KPI, Configure measurement).
// The enum label maps in factoryModel.ts / composeTask.ts stay English for the
// rest of the Factory, which has not had its i18n pass; the setup modals read
// their words from `t.kpis.setup_*` through this one hook instead.
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { KpiCategory, MeasureKind } from './factoryModel';

export interface DerivedMetricWords { label: string; hint: string }

export function useKpiSetupLabels() {
  const { t } = useTranslation();
  return useMemo(() => {
    const k = t.kpis;
    return {
      category: {
        technical: k.category_technical, quality: k.category_quality,
        traffic: k.category_traffic, value: k.category_value,
      } satisfies Record<KpiCategory, string>,
      kind: {
        codebase: k.setup_kind_codebase, connector: k.setup_kind_connector,
        derived: k.setup_kind_derived, manual: k.setup_kind_manual,
      } satisfies Record<MeasureKind, string>,
      cadence: {
        daily: k.setup_cadence_daily, weekly: k.setup_cadence_weekly, manual: k.setup_cadence_manual,
      } satisfies Record<'daily' | 'weekly' | 'manual', string>,
      tier: {
        north_star: k.setup_tier_north_star, primary: k.setup_tier_primary, supporting: k.setup_tier_supporting,
      },
      direction: { up: k.setup_dir_up, down: k.setup_dir_down },
      measured: { manual: k.setup_measured_manual, auto: k.setup_measured_auto },
      /** Derived-metric words by metric id (ids mirror `DERIVED_METRICS` in composeTask.ts). */
      derived: {
        qa_bounce_rate: { label: k.setup_derived_qa_bounce_rate, hint: k.setup_derived_qa_bounce_rate_hint },
        exec_failure_rate: { label: k.setup_derived_exec_failure_rate, hint: k.setup_derived_exec_failure_rate_hint },
        incident_rate: { label: k.setup_derived_incident_rate, hint: k.setup_derived_incident_rate_hint },
        parked_review_age_days: { label: k.setup_derived_parked_review_age_days, hint: k.setup_derived_parked_review_age_days_hint },
      } as Record<string, DerivedMetricWords>,
    };
  }, [t]);
}
