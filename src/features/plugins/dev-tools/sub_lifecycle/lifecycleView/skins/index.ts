// The skin registry. A skin IS a variant on this surface (see `types.ts`), so
// this list is the prototype round's shortlist and the default is the look the
// owner kept, with its component defects repaired.
import { ENGRAVED } from './engraved';
import { PLATED } from './plated';
import type { LifecycleSkin, SkinId } from './types';
import { WASH } from './wash';

export const SKINS: readonly LifecycleSkin[] = [WASH, ENGRAVED, PLATED];

export const DEFAULT_SKIN_ID: SkinId = 'wash';

export function skinById(id: SkinId): LifecycleSkin {
  return SKINS.find((s) => s.id === id) ?? WASH;
}

export { LifecycleSkinProvider, useSkin } from './context';
export type { LifecycleSkin, SkinId } from './types';
