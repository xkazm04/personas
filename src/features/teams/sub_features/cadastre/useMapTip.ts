// The map's pointer: which parcel or district the tip names (with the winner's
// 220ms grace so the pointer can cross into the tip), which register rows its
// claimants sit on, and what a click on a parcel does.
import { useCallback, useMemo, useRef, useState } from 'react';

import type { Parcel } from './cadastreLayout';
import type { MapHover } from './CadastreMap';
import type { Cadastre } from './useCadastre';

export function useMapTip(cad: Cadastre, openDeed: (key: string, from?: HTMLElement | null) => void) {
  const [hover, setHover] = useState<MapHover | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const onHover = useCallback((h: MapHover | null) => {
    window.clearTimeout(hideTimer.current);
    if (h) setHover((cur) => (cur && cur.kind === h.kind && cur.p === h.p && cur.d === h.d ? cur : h));
    else hideTimer.current = window.setTimeout(() => setHover(null), 220);
  }, []);
  const keep = useCallback(() => window.clearTimeout(hideTimer.current), []);
  const drop = useCallback(() => { window.clearTimeout(hideTimer.current); setHover(null); }, []);

  const hotClaims = useMemo(
    () => new Set(hover?.p ? (cad.claims.get(hover.p.id) ?? []).map((r) => r.key) : []),
    [hover, cad.claims],
  );

  /* A parcel click opens the next deed that claims it, cycling from the
     focused one; open ground switches the register to the unclaimed list. */
  const onParcel = useCallback((P: Parcel, el: Element) => {
    drop();
    const fs = [...(cad.claims.get(P.id) ?? [])].sort((a, b) => a.rank - b.rank);
    if (fs.length) {
      const next = fs[(fs.findIndex((r) => r.key === cad.focus) + 1) % fs.length]!;
      openDeed(next.key, el as HTMLElement);
      return;
    }
    if (cad.filter !== 'unclaimed') cad.toggleFilter('unclaimed');
    cad.setOgFocus(P.id);
    cad.setHotCtx(P.id);
  }, [cad, openDeed, drop]);

  return { hover, onHover, keep, drop, hotClaims, onParcel };
}
