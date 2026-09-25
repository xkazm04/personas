// Which Features page the reader sees. Two surfaces stand behind one
// persisted switch while the Cadastre is promoted (contest features-page-r2,
// 2026-09-23, vault: .contest/Contest/contests/features-page-r2.md): the
// shipped Board, and the fused Cadastre the owner chose. The recipe is the
// KPI variant switch (`sub_kpis/kpiVariant.ts`). A persisted value naming a
// variant that no longer exists falls back to the shipped one; the owner
// descopes one of the two once the new experience is polished.
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type FeaturesVariant = 'board' | 'cadastre';

export const FEATURES_VARIANTS: readonly FeaturesVariant[] = ['board', 'cadastre'];

/** Shared by the switcher (tabs) and the page (the one tabpanel). */
export const FEATURES_VARIANT_TAB_PREFIX = 'features-variant';

const VARIANT_KEY = 'features-variant';
const DEFAULT_VARIANT: FeaturesVariant = 'board';

export function readFeaturesVariant(): FeaturesVariant {
  const raw = safeLocalGet(VARIANT_KEY, 'features:variant');
  return (FEATURES_VARIANTS as readonly string[]).includes(raw ?? '') ? (raw as FeaturesVariant) : DEFAULT_VARIANT;
}

export function useFeaturesVariant(): [FeaturesVariant, (next: FeaturesVariant) => void] {
  const [variant, setVariantState] = useState<FeaturesVariant>(readFeaturesVariant);
  const setVariant = useCallback((next: FeaturesVariant) => {
    safeLocalSet(VARIANT_KEY, next, 'features:variant');
    setVariantState(next);
  }, []);
  return [variant, setVariant];
}
