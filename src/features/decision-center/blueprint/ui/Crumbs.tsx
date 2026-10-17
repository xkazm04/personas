import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSheet } from '../controller/SheetContext';
import { figures, waitingOf } from '../model/counts';
import { placeOf } from '../model/scope';
import { useViewLevel } from '../state/viewStore';
import { CrumbSum } from './header/CrumbSum';
import { Press } from './Press';

/** Room kept for the summary beside the crumbs: parents shorten before it drops below this (bp SUM_MIN). */
const SUM_MIN = 220;

/** The full chain is wider than the crumb row leaves beside the summary. */
const tooWide = (el: HTMLElement, fullW: number) => fullW > el.clientWidth - SUM_MIN;

/**
 * The crumbs (bp Header Crumbs): product › wing › room › bay, 19 px sans 600 uppercase, each a way back up, then the
 * place's measured summary. The parents shorten (a wing to its letter, a room to its code) only when the full chain
 * does not fit the header's real width: measured once per place with full labels, compared on every resize.
 */
export function Crumbs() {
  const s = useSheet();
  const { B } = s.text;
  const lv = useViewLevel(s.view);
  const n = s.ui.sheet ? 3 : lv.n;
  const L = s.plan.L;
  const wing = lv.wing ? L.WING[lv.wing] : undefined, room = lv.room ? L.ROOM[lv.room] : undefined, bay = lv.bay ? L.BAY[lv.bay] : undefined;
  const feats = useMemo(() => placeOf(L, s.scope)?.feats ?? s.plan.S.features, [L, s.scope, s.plan]);
  const { n: fn, live, build, paper, dep, bad } = figures(feats);
  const d = { n: fn, live, build, paper, dep, bad, asks: waitingOf(s.queue) };

  const chain: { full: string; short: string }[] = [{ full: s.data.product.name, short: s.data.product.name }];
  if (n >= 1 && wing) chain.push({ full: `${wing.def.letter} · ${wing.def.name}`, short: wing.def.letter });
  if (n >= 2 && room) chain.push({ full: room.d.name, short: room.d.code || room.d.name });
  if (n >= 3 && bay) chain.push({ full: bay.cap.name, short: bay.cap.name });
  const key = chain.map((x) => x.full).join('/');

  const nav = useRef<HTMLElement>(null), full = useRef(0);
  const [sh, setSh] = useState({ key: '', short: false });
  const short = sh.key === key && sh.short;
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el || sh.key === key) return;
    const bs = el.querySelectorAll<HTMLElement>('.bp-crumb'), a = bs[0], z = bs[bs.length - 1];
    full.current = a && z ? z.offsetLeft + z.offsetWidth - a.offsetLeft : 0;
    setSh({ key, short: tooWide(el, full.current) });
  }, [key, sh.key]);
  useEffect(() => {
    const el = nav.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const v = tooWide(el, full.current); setSh((o) => (o.key === key && o.short !== v && full.current ? { key, short: v } : o)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);

  const last = chain.length - 1;
  return (
    <nav className="bp-l2" aria-label={B.crumbs} ref={nav}>
      {chain.map((x, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="bp-sep" aria-hidden="true">{'›'}</span>}
          <Press tone="bp-crumb" onClick={() => s.nav.toLevel(i)} current={i === last} aria-label={x.full}>{short && i < last ? x.short : x.full}</Press>
        </span>
      ))}
      <CrumbSum navRef={nav} pk={key} d={d} />
    </nav>
  );
}
