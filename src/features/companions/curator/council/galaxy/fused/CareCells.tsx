// The folded dock's cells: every subject that needs the person in the scope
// the reader stands in, at reading size, grouped under its category or
// subcategory. A claim-coloured bar as tall as its technique count sits
// beside each name; a waiting decision adds an amber pin. An empty scope says
// so in words, with the count it checked. A click flies to the star.
import { Fragment, useEffect, useRef, type RefObject } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import type { GalaxyEngine } from '../engine/GalaxyEngine';
import type { SubjectNode } from '../engine/types';
import { careTone, type CareGroup } from './careModel';
import { careKinds } from './fusedModel';
import { useFusedStore, type CareKind } from './fusedStore';
import { useFusedStrings } from './fusedStrings';

interface Props {
  engine: GalaxyEngine | null;
  groups: CareGroup[];
  all: number;
  scopeName: string;
  here: SubjectNode | null;
  waitingStars: Set<string>;
  cellsRef: RefObject<HTMLDivElement | null>;
}

const barHeight = (s: SubjectNode) => Math.round(9 + 25 * Math.sqrt(s.techniques.length / 27));

export function CareCells({ engine, groups, all, scopeName, here, waitingStars, cellsRef }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const filters = useFusedStore((st) => st.filters);
  const setTip = useFusedStore((st) => st.setTip);
  const onKinds = (Object.keys(filters) as CareKind[]).filter((k) => filters[k]);
  const moreRef = useRef<() => void>(() => {});

  // The strip scrolls sideways: the wheel scrolls it, and a fade at either
  // edge says there is more (a native listener, because a React onWheel
  // cannot preventDefault).
  useEffect(() => {
    const el = cellsRef.current;
    if (!el) return;
    const edges = () => {
      el.classList.toggle('more-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      el.classList.toggle('more-l', el.scrollLeft > 2);
    };
    moreRef.current = edges;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    edges();
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('scroll', edges);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('scroll', edges);
    };
  }, [cellsRef]);

  useEffect(() => {
    moreRef.current();
    cellsRef.current?.querySelector('.cell.here')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [groups, here, cellsRef]);

  const words = (x: SubjectNode) => {
    const kinds = careKinds(x, waitingStars);
    const out: Array<{ text: string; em: boolean }> = [];
    if (kinds.includes('waiting')) out.push({ text: f.care_waits, em: true });
    if (x.overlay?.pending) out.push({ text: tx(f.care_pending, { count: x.overlay.pending }), em: false });
    if (x.overlay?.rejected) out.push({ text: tx(f.care_rejected, { count: x.overlay.rejected }), em: true });
    out.push({ text: tx(f.care_techniques, { count: x.techniques.length }), em: false });
    return out;
  };

  let empty: string | null = null;
  if (!onKinds.length) empty = f.care_filters_off;
  else if (!groups.length) empty = tx(f.care_none, { scope: scopeName, count: s.n(all) });

  return (
    <div className="fz-cells" role="list" ref={cellsRef}>
      {empty ? <div className="none">{empty}</div> : null}
      {groups.map((g) => (
        <Fragment key={g.key}>
          <div className="grp" data-role="hud-care-group">
            {g.over ? <span>{g.over}</span> : null}
            <b>{g.name || f.care_unsorted}</b>
          </div>
          {g.subjects.map((x) => (
            <button
              key={x.slug}
              type="button"
              role="listitem"
              className={`cell${waitingStars.has(x.slug) ? ' w' : ''}${here === x ? ' here' : ''}`}
              style={{ ['--c' as string]: careTone(x, waitingStars) }}
              data-role="hud-care-cell"
              data-s={x.slug}
              onClick={() => engine?.goTo(x)}
              onMouseEnter={(e) => {
                engine?.setHover(x);
                const r = e.currentTarget.getBoundingClientRect();
                const host = e.currentTarget.closest('.fz')?.getBoundingClientRect();
                setTip({ node: x, x: r.left - (host?.left ?? 0) + 12, y: r.top - (host?.top ?? 0) - 8, above: true });
              }}
              onMouseLeave={() => {
                engine?.setHover(null);
                setTip(null);
              }}
            >
              <span className="bar" style={{ height: barHeight(x) }} />
              <span className="cn" data-role="hud-care-cell-title">
                {x.title}
              </span>
              <span className="cm">
                {words(x).map((w, i) => (
                  <span key={i}>
                    {i ? ' · ' : ''}
                    {w.em ? <em>{w.text}</em> : w.text}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export default CareCells;
