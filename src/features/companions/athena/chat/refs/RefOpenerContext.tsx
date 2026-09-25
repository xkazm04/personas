/**
 * Per-surface overrides for `openRef` (see there). The Current layout mounts no
 * provider and gets the defaults; each prototype variant provides its layer.
 */

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { openRef, type RefOpenerOverrides } from './openRef';
import type { RefKind } from './refGrammar';

const RefOpenerContext = createContext<RefOpenerOverrides>({});

export function RefOpenerProvider({ value, children }: { value: RefOpenerOverrides; children: ReactNode }) {
  return <RefOpenerContext.Provider value={value}>{children}</RefOpenerContext.Provider>;
}

/** `(kind, handle) => openRef(kind, handle, <this surface's overrides>)`. */
export function useRefOpener(): (kind: RefKind, handle: string) => boolean {
  const overrides = useContext(RefOpenerContext);
  return useCallback((kind: RefKind, handle: string) => openRef(kind, handle, overrides), [overrides]);
}
