// Which blueprint the Twin shows (spark twin-portable-blueprint, 2026-10-01).
// Four prototype directions compete behind one persisted switch on the Detail
// page; the training overlay reads the same pick, so judging a variant judges
// both surfaces at once.
// TODO(prototype, 2026-10-01): the owner picks or fuses from the running app;
// the losing variants and this switch are deleted in that round.
import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

import { BLUEPRINT_VARIANT_IDS, type BlueprintVariantId } from './blueprintContract';

const VARIANT_KEY = 'twin-blueprint-variant';
const DEFAULT_VARIANT: BlueprintVariantId = 'drafting';

export function readBlueprintVariant(): BlueprintVariantId {
  const raw = safeLocalGet(VARIANT_KEY, 'twin:blueprint-variant');
  return (BLUEPRINT_VARIANT_IDS as readonly string[]).includes(raw ?? '') ? (raw as BlueprintVariantId) : DEFAULT_VARIANT;
}

export function useBlueprintVariant(): [BlueprintVariantId, (next: BlueprintVariantId) => void] {
  const [variant, setVariantState] = useState<BlueprintVariantId>(readBlueprintVariant);
  const setVariant = useCallback((next: BlueprintVariantId) => {
    safeLocalSet(VARIANT_KEY, next, 'twin:blueprint-variant');
    setVariantState(next);
  }, []);
  return [variant, setVariant];
}
