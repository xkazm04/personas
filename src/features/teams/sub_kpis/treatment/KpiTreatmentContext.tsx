// The active treatment, and the hook every KPI overview part reads it through.
//
// The default IS the baseline, so a part that reads `useKT()` outside any
// provider renders exactly what it rendered before this file existed - which
// is what lets the group layer and the detail sections stay on the static
// import without drifting.
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { KpiVariant } from '../kpiVariant';
import { BASELINE_TREATMENT, type KpiTreatment, type KpiTreatmentId } from './kpiTreatment';
import { MAP_TREATMENTS } from './treatments.map';
import { LEDGER_TREATMENTS } from './treatments.ledger';
import { RIVER_TREATMENTS } from './treatments.river';

/** The treatments offered for each theme, baseline first so the default is
 *  always the leftmost choice and always the current look. */
export const TREATMENTS_FOR: Record<KpiVariant, readonly KpiTreatment[]> = {
  map: [BASELINE_TREATMENT, ...MAP_TREATMENTS],
  ledger: [BASELINE_TREATMENT, ...LEDGER_TREATMENTS],
  river: [BASELINE_TREATMENT, ...RIVER_TREATMENTS],
};

/** Resolve a (theme, treatment id) pair, falling back to the baseline - an id
 *  from another theme is not an error, it is a stale selection. */
export function treatmentFor(variant: KpiVariant, id: KpiTreatmentId): KpiTreatment {
  return TREATMENTS_FOR[variant].find((tr) => tr.id === id) ?? BASELINE_TREATMENT;
}

const KpiTreatmentContext = createContext<KpiTreatment>(BASELINE_TREATMENT);

/** The type scale and chrome vocabulary the surrounding overview renders in. */
export function useKT(): KpiTreatment {
  return useContext(KpiTreatmentContext);
}

export function KpiTreatmentProvider({
  variant,
  treatmentId,
  children,
}: {
  variant: KpiVariant;
  treatmentId: KpiTreatmentId;
  children: ReactNode;
}) {
  const value = useMemo(() => treatmentFor(variant, treatmentId), [variant, treatmentId]);
  return <KpiTreatmentContext.Provider value={value}>{children}</KpiTreatmentContext.Provider>;
}
