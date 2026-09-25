// Opening and closing a deed's layer. The row (or the parcel that was
// clicked) grows into the layer through a view transition; closing shrinks it
// back onto the row and returns keyboard focus to the register, whose active
// option is that row. Without view transitions the layer cross-fades in, and
// under reduced motion it simply appears.
import { useCallback, useRef, useState } from 'react';

import { prefersReducedMotion, runDeedTransition } from './deedTransition';
import { rowDomId } from './RegisterRow';
import type { Cadastre } from './useCadastre';

export function useDeedLayer(cad: Cadastre) {
  const listRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLElement>(null);
  const [fallbackIn, setFallbackIn] = useState(false);

  const openDeed = useCallback((key: string, from?: HTMLElement | null) => {
    if (!cad.byKey.has(key)) return;
    const update = () => { cad.focusRow(key); cad.setSel(key); };
    if (cad.open) { update(); return; }
    const ran = runDeedTransition(update, from ?? document.getElementById(rowDomId(key)), () => layerRef.current, 'in');
    setFallbackIn(!ran && !prefersReducedMotion());
    layerRef.current?.querySelector<HTMLElement>('.ly-right')?.focus({ preventScroll: true });
  }, [cad]);

  const closeLayer = useCallback(() => {
    if (!cad.open) return;
    const key = cad.sel;
    runDeedTransition(() => cad.setSel(null), layerRef.current, () => (key ? document.getElementById(rowDomId(key)) : null), 'out');
    setFallbackIn(false);
    listRef.current?.focus({ preventScroll: true });
  }, [cad]);

  return { listRef, layerRef, fallbackIn, openDeed, closeLayer };
}
