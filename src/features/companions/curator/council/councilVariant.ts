// Which Council page the reader sees. Two surfaces stand behind one
// persisted switch while the fused instrument is promoted (contest
// council-hud rounds 1-3, 2026-09-22/23, vault:
// .contest/Contest/contests/council-hud-r2.md): the shipped classic galaxy
// with its strip and counts card, and the fused HUD the owner chose (the
// cross-section dock, the bezel lens and the bare field as keyboard modes,
// with the altitude timeline and the named decisions). The recipe is the
// KPI variant switch (`teams/sub_kpis/kpiVariant.ts`). A persisted value
// naming a variant that no longer exists falls back to the shipped one.
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type CouncilVariant = 'classic' | 'fused';

export const COUNCIL_VARIANTS: readonly CouncilVariant[] = ['classic', 'fused'];

/** Shared by the switcher (tabs) and the page (the one tabpanel). */
export const COUNCIL_VARIANT_TAB_PREFIX = 'council-variant';

const VARIANT_KEY = 'council-variant';
const DEFAULT_VARIANT: CouncilVariant = 'classic';

export function readCouncilVariant(): CouncilVariant {
  const raw = safeLocalGet(VARIANT_KEY, 'council:variant');
  return (COUNCIL_VARIANTS as readonly string[]).includes(raw ?? '') ? (raw as CouncilVariant) : DEFAULT_VARIANT;
}

export function useCouncilVariant(): [CouncilVariant, (next: CouncilVariant) => void] {
  const [variant, setVariantState] = useState<CouncilVariant>(readCouncilVariant);
  const setVariant = useCallback((next: CouncilVariant) => {
    safeLocalSet(VARIANT_KEY, next, 'council:variant');
    setVariantState(next);
  }, []);
  return [variant, setVariant];
}
