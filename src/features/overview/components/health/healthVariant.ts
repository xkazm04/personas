/**
 * Which of the three 2-layer System Check prototypes is mounted (kit batch home-3).
 *
 * The owner asked for "three prototypes of different 2-layer UI approaches" and will choose by
 * looking, so all three ship in one build behind one persisted switch, exactly as the Twin's
 * blueprint contest did (`plugins/twin/.../blueprintVariant.ts`). The page harness writes this key
 * from `?kit=<id>`, so `shoot.mjs --kit board|spine|triage` shoots whichever one it is given.
 *
 * TODO(prototype, 2026-10-03): when the owner picks one, the other two and this switch come out
 * together; the surface keeps the shared layer (`healthModel`, `useHealthSections`, `HealthRows`,
 * `HealthDetail`, `HealthActions`), which is deliberately variant-free.
 */
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export const HEALTH_VARIANT_IDS = ['board', 'spine', 'triage'] as const;
export type HealthVariantId = (typeof HEALTH_VARIANT_IDS)[number];

const VARIANT_KEY = 'system-check-variant';
const DEFAULT_VARIANT: HealthVariantId = 'board';

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
