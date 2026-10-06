// The chosen skin, read by every block. Separate from the data context so a
// block's two dependencies stay legible: the MODEL says what to draw, the SKIN
// says how. Defaults to `wash` rather than throwing: a block rendered without
// a provider still has a complete, correct look, which is what the page ships.
import { createContext, useContext, type ReactNode } from 'react';

import type { LifecycleSkin } from './types';
import { WASH } from './wash';

const SkinContext = createContext<LifecycleSkin>(WASH);

export function LifecycleSkinProvider({ skin, children }: { skin: LifecycleSkin; children: ReactNode }) {
  return <SkinContext.Provider value={skin}>{children}</SkinContext.Provider>;
}

export function useSkin(): LifecycleSkin {
  return useContext(SkinContext);
}
