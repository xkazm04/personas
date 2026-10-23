import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useSheet } from '../../controller/SheetContext';

/** The place's figures the summary prints. */
export interface SumFigures { n: number; live: number; build: number; paper: number; dep: number; bad: number; asks: number }

/** The last drop tier: past it the line is read by assistive tech only. */
const SUM_LAST = 7;

/**
 * The place's summary beside the crumbs (bp Header CrumbSum, Header.tsx:26-92): "N features · N live · N being built ·
 * N proposed · N in trouble · N questions waiting". MEASURED, not estimated: while the line is wider than the room
 * the crumb row leaves it, one tier drops and the line is measured again. Tiers: proposed and retired (1), being
 * built (2), the feature count (3), live (4); then trouble and questions as marks with their counts (5), the trouble
 * mark alone (6), and at 7 the line leaves the screen but stays in the accessibility tree. Never cut mid-word.
 */
export function CrumbSum({ navRef, pk, d }: { navRef: RefObject<HTMLElement | null>; pk: string; d: SumFigures }) {
  const { B, tx } = useSheet().text;
  const el = useRef<HTMLSpanElement>(null);
  const sig = pk + '|' + [d.n, d.live, d.build, d.paper, d.dep, d.bad, d.asks].join();
  const [st, setSt] = useState({ sig: '', lv: 0 });
  const lv = st.sig === sig ? st.lv : 0;
  useLayoutEffect(() => {
    const n = el.current;
    if (!n) return;
    if (n.scrollWidth > n.clientWidth + 1 && lv < SUM_LAST) {
      const next = lv + 1;
      setSt({ sig, lv: next >= 5 && !d.bad && !d.asks ? SUM_LAST : next === 6 && !(d.bad && d.asks) ? SUM_LAST : next });
    } else if (st.sig !== sig) setSt({ sig, lv });
  }, [lv, sig, st.sig, d.bad, d.asks]);
  useEffect(() => {
    const n = navRef.current;
    if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSt({ sig: '', lv: 0 }));
    ro.observe(n);
    return () => ro.disconnect();
  }, [navRef]);

  const features = tx(d.n === 1 ? B.sum_features_one : B.sum_features_other, { count: d.n });
  const live = tx(B.sum_live, { count: d.live }), build = tx(B.sum_building, { count: d.build }), paper = tx(B.sum_proposed, { count: d.paper });
  const dep = d.dep ? tx(B.sum_retiring, { count: d.dep }) : '';
  const bad = d.bad ? tx(B.sum_trouble, { count: d.bad }) : '';
  const asks = d.asks ? tx(d.asks === 1 ? B.sum_questions_one : B.sum_questions_other, { count: d.asks }) : '';
  const text = [features, live, build, paper, dep, bad, asks].filter(Boolean).join(' · ');

  if (lv >= SUM_LAST) return <span className="sum off" ref={el}>{text}</span>;
  if (lv === 5 || lv === 6) {
    const withAsks = lv === 5 || !d.bad;
    return (
      <span className="sum" ref={el}>
        <span className="sr-only">{text}</span>
        {d.bad > 0 && <span className="cl mk" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M7 2 12 7 7 12 2 7Z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><em>{d.bad}</em></span>}
        {withAsks && d.asks > 0 && <span className="cl mk" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M3 13V2h8l-2 3 2 3H3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><i>{d.asks}</i></span>}
      </span>
    );
  }
  const parts: ReactNode[] = [];
  if (lv < 3) parts.push(<span key="n">{features}</span>);
  if (lv < 4) parts.push(<b key="l">{live}</b>);
  if (lv < 2) parts.push(<span key="b">{build}</span>);
  if (lv < 1) { parts.push(<span key="p">{paper}</span>); if (dep) parts.push(<span key="d">{dep}</span>); }
  if (bad) parts.push(<em key="t">{bad}</em>);
  if (asks) parts.push(<i key="q">{asks}</i>);
  return (
    <span className="sum" ref={el} data-testid="blueprint-sum" data-tier={lv}>
      {parts.map((x, i) => <span key={i} className="cl">{i > 0 ? ' · ' : ''}{x}</span>)}
    </span>
  );
}
