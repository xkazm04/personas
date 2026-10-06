// Which overview renderer the KPI Dashboard shows. Three surfaces compete
// behind one persisted switch (kpi-strategic-map spark, 2026-09-17). The
// consolidation round ran as a blind design contest on 2026-09-21 (vault:
// .contest/Contest/contests/kpi-descent.md): the owner kept Map, Ledger and
// River and deleted Classic, Projects and Portfolio outright. A persisted
// value naming one of the deleted three falls back to the default.
//
// 2026-10-06 (prototype round 4): three NEW concepts sit beside those three,
// visible in DEV BUILDS ONLY. They are not product surface yet - they are a
// design review bench - so the production list is unchanged, the default is
// still the shipped Map, and a persisted prototype id read in a production
// build falls back to the default because `KPI_VARIANTS` no longer contains
// it. The gate is a named module constant rather than an inline brace at a
// render site (`inline-dev-build-gate`).
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type KpiVariant = 'map' | 'ledger' | 'river' | 'assay' | 'almanac' | 'console';

/** The three that ship. These are the ones with translated labels. */
export const KPI_SHIPPED_VARIANTS: readonly KpiVariant[] = ['map', 'ledger', 'river'];

/** The three under review. Dev builds only; labels are deliberately NOT
 *  translated - a review bench must not spend 14 locales on concept names
 *  that may not survive the round (same call as the retired treatment axis). */
export const KPI_PROTOTYPE_VARIANTS: readonly KpiVariant[] = ['assay', 'almanac', 'console'];

/** Dev builds only: a design review bench is not product surface. */
export const SHOW_KPI_PROTOTYPES = import.meta.env.DEV;

export const KPI_VARIANTS: readonly KpiVariant[] = SHOW_KPI_PROTOTYPES
  ? [...KPI_SHIPPED_VARIANTS, ...KPI_PROTOTYPE_VARIANTS]
  : KPI_SHIPPED_VARIANTS;

/** The concept names, untranslated on purpose (see above). Each is the one
 *  word the concept is about, not a finish. */
export const KPI_PROTOTYPE_LABELS: Readonly<Record<string, string>> = {
  assay: 'Assay',
  almanac: 'Almanac',
  console: 'Console',
};

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
