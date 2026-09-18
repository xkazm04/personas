// Which overview renderer the KPI Dashboard shows. Six prototypes compete
// behind one persisted switch (kpi-strategic-map spark, 2026-09-17); the
// losers are deleted in a later consolidation round, as drive-variant was.
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type KpiVariant = 'classic' | 'map' | 'ledger' | 'treemap' | 'grid' | 'river';

export const KPI_VARIANTS: readonly KpiVariant[] = ['map', 'ledger', 'treemap', 'grid', 'river', 'classic'];

const VARIANT_KEY = 'kpi-variant';
const DEFAULT_VARIANT: KpiVariant = 'map';

export function readKpiVariant(): KpiVariant {
  const raw = safeLocalGet(VARIANT_KEY, 'kpis:variant');
  return (KPI_VARIANTS as readonly string[]).includes(raw ?? '') ? (raw as KpiVariant) : DEFAULT_VARIANT;
}

export function useKpiVariant(): [KpiVariant, (next: KpiVariant) => void] {
  const [variant, setVariantState] = useState<KpiVariant>(readKpiVariant);
  const setVariant = useCallback((next: KpiVariant) => {
    safeLocalSet(VARIANT_KEY, next, 'kpis:variant');
    setVariantState(next);
  }, []);
  return [variant, setVariant];
}
