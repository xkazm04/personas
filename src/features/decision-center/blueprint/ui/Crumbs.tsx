import { useMemo } from 'react';
import { useSheet } from '../controller/SheetContext';
import { counts } from '../model/aggregates';
import { placeOf } from '../model/scope';
import { useViewLevel } from '../state/viewStore';
import { Press } from './Press';

/** The trail (bp Header crumbs): product > wing > room > bay, each a way back up, and the counts of the place. */
export function Crumbs() {
  const s = useSheet();
  const { B } = s.text, w = s.words;
  const lv = useViewLevel(s.view);
  const n = s.ui.sheet ? 3 : lv.n;
  const L = s.plan.L;
  const wing = lv.wing ? L.WING[lv.wing] : undefined, room = lv.room ? L.ROOM[lv.room] : undefined, bay = lv.bay ? L.BAY[lv.bay] : undefined;
  const feats = useMemo(() => {
    const o = placeOf(L, s.scope);
    return o ? o.feats : s.plan.S.features;
  }, [L, s.scope, s.plan]);
  const c = counts(feats);
  const waiting = s.queue.filter((p) => p.status === 'proposed').length;
  const go = (i: number) => s.nav.toLevel(i);
  const part = (i: number, label: string) => (
    <>
      <span className="bp-sep" aria-hidden="true">{'›'}</span>
      <Press tone={`bp-crumb${n === i ? ' bp-cur' : ''}`} onClick={() => go(i)} current={n === i}>{label}</Press>
    </>
  );
  return (
    <nav className="bp-l2" aria-label={B.crumbs}>
      <Press tone={`bp-crumb${n === 0 ? ' bp-cur' : ''}`} onClick={() => go(0)} current={n === 0}>{s.data.product.name}</Press>
      {n >= 1 && wing && part(1, wing.def.letter)}
      {n >= 2 && room && part(2, room.d.name)}
      {n >= 3 && bay && part(3, bay.cap.name)}
      <span className="bp-cnt">
        {n === 0 ? `${w.features(c.n)} · ` : ''}<b>{w.live(c.live)}</b>{c.build ? ` · ${w.building(c.build)}` : ''}{c.dep ? ` · ${w.demolish(c.dep)}` : ''} {'·'} <span className="bp-wait">{w.waiting(waiting)}</span>
      </span>
    </nav>
  );
}
