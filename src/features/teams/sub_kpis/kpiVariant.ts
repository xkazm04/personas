// Which overview renderer the KPI Dashboard shows. Three surfaces compete
// behind one persisted switch (kpi-strategic-map spark, 2026-09-17). The
// consolidation round ran as a blind design contest on 2026-09-21 (vault:
// .contest/Contest/contests/kpi-descent.md): the owner kept Map, Ledger and
// River and deleted Classic, Projects and Portfolio outright. A persisted
// value naming one of the deleted three falls back to the default.
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type KpiVariant = 'map' | 'ledger' | 'river';

export const KPI_VARIANTS: readonly KpiVariant[] = ['map', 'ledger', 'river'];

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
