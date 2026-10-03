/**
 * Which of the three 2-layer System Check prototypes is mounted (kit batch home-3).
 *
 * The owner asked for "three prototypes of different 2-layer UI approaches" and will choose by
 * looking, so all of them ship in one build behind one persisted switch, exactly as the Twin's
 * blueprint contest did (`plugins/twin/.../blueprintVariant.ts`). The page harness writes this key
 * from `?kit=<id>`, so `shoot.mjs --kit fusion|board|spine|triage` shoots whichever one it is given.
 *
 * `machine` is the DEFAULT since 2026-10-03 (builder FG, doctrine 6c): it is `fusion` with layer 1
 * redrawn as a FIGURE rather than as a board of cards, which is the thing the owner's verdict was
 * actually about ("prototypes following the kit then look terrible ... what I would expect is the
 * level of visualization we have in Strata"). The fusion's information architecture is untouched,
 * so the change the owner is being asked to judge is exactly the one he asked for.
 *
 * `fusion` was the DEFAULT before it and is the one it was composed from: the Director resolved the field by
 * composing rather than choosing (A's board as layer 1, C's attention list under it, B's full audit
 * table behind C's Segmented), which is the owner's recorded way of settling a contest. `board`,
 * `spine` and `triage` stay mounted as the studies the fusion was composed FROM, so the comparison
 * he is being asked to judge is still one keypress away.
 *
 * TODO(prototype, 2026-10-03): when the owner confirms, the three studies and this switch come out
 * together; the surface keeps the shared layer (`healthModel`, `useHealthSections`, `HealthRows`,
 * `HealthDetail`, `HealthActions`), which is deliberately variant-free.
 */
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export const HEALTH_VARIANT_IDS = ['machine', 'fusion', 'board', 'spine', 'triage'] as const;
export type HealthVariantId = (typeof HEALTH_VARIANT_IDS)[number];

const VARIANT_KEY = 'system-check-variant';
const DEFAULT_VARIANT: HealthVariantId = 'machine';

export function readHealthVariant(): HealthVariantId {
  const raw = safeLocalGet(VARIANT_KEY, 'health:variant');
  return (HEALTH_VARIANT_IDS as readonly string[]).includes(raw ?? '') ? (raw as HealthVariantId) : DEFAULT_VARIANT;
}

export function useHealthVariant(): [HealthVariantId, (next: HealthVariantId) => void] {
  const [variant, setState] = useState<HealthVariantId>(readHealthVariant);
  const set = useCallback((next: HealthVariantId) => {
    safeLocalSet(VARIANT_KEY, next, 'health:variant');
    setState(next);
  }, []);
  return [variant, set];
}
