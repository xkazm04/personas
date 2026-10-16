import { useLayoutEffect, useRef, useState } from 'react';
import '../styles/overlays.css';
import { useSheet } from '../controller/SheetContext';
import type { TipStore } from '../state/tipStore';
import { useTip } from '../state/tipStore';
import { ClusterBody, PlaceBody, TileBody } from './overlays/hoverBodies';

/**
 * The hover card (bp Overlays.tsx HoverCard, blueprint.css #hov): 360 px on the card ground, a 3 px rule in the lens
 * accent on top, a 12 px mono kicker, the name at 26 px, then what the fixture or place says on the date shown. It
 * follows the pointer and flips above or left of it near an edge. It is a reading aid for the pointer only (every word
 * on it is also in the queue, the find list and the feature sheet), so it is hidden from assistive technology.
 */
export function HoverTip({ store }: { store: TipStore }) {
  const s = useSheet();
  const tip = useTip(store);
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(160);
  useLayoutEffect(() => { const n = box.current?.offsetHeight; if (n && n !== h) setH(n); }, [tip, h]);
  if (!tip) return null;
  const T = tip.fid ? s.plan.L.TILE[tip.fid] : undefined;
  const R = !T && tip.room ? s.plan.L.ROOM[tip.room] : undefined;
  // at the site level a place is its wing (bp hovers wings at L0, rooms below)
  const place = R && s.engine && s.engine.cam.level().n === 0 ? R.wing : R;
  const cluster = tip.flag && tip.flag.fids.length > 1 ? tip.flag : null;
  if (!cluster && !T && !place) return null;
  const W = s.engine?.cam.FW ?? 800, H = s.engine?.cam.FH ?? 600;
  let left = tip.px + 18, top = tip.py + 18;
  if (left + 360 > W - 8) left = tip.px - 360 - 18;
  if (top + h > H - 8) top = tip.py - h - 18;
  left = Math.max(8, left); top = Math.max(8, top);
  return (
    <div ref={box} className="bp-hov" style={{ left, top }} aria-hidden="true" data-testid="blueprint-hover">
      {cluster ? <ClusterBody s={s} flag={cluster} /> : T ? <TileBody s={s} f={T.f} flag={tip.flag} /> : place ? <PlaceBody s={s} o={place} /> : null}
    </div>
  );
}
