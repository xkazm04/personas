// A · View (PORTED from bp src/components/rail/wide/view.tsx): a section nav on the left (Window, What changed, Health)
// and every section stacked on the right at a reading size. The nav scrolls the detail to a section and follows the
// detail's scroll. The window (24 h, 7 d, 14 d) is the sheet's `viewDays`: the delta marks, the title block's
// "changed" count and the list below read it.
// EDIT (port): bp's Modes (GA readiness, blast radius) and Whose desk (people, open questions) are not brought: this
// plan draws neither mode and the store has no people. The changed features are listed here (bp only counts them),
// from the events log's stage revisions.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSheet } from '../../../controller/SheetContext';
import { deltaWin } from '../../../engine/travel';
import { Press } from '../../Press';
import { Row, Sec, useListRef, useWalk } from './shell';
import { ViewChanged, ViewHealth } from './ViewSections';

/** bp's window choices. */
export const VIEW_WINDOWS = [1, 7, 14] as const;

export function ViewPanel() {
  const s = useSheet();
  const { B, tx } = s.text;
  const S = s.plan.S, day = s.ui.asOf ?? S.asOf, days = s.ui.viewDays;
  const changed = useMemo(() => S.features.flatMap((f) => { const r = deltaWin(f, day, days); return r ? [{ f, r }] : []; }).sort((a, b) => (a.r.date < b.r.date ? 1 : -1)), [S, day, days]);
  const win = (d: number) => (d === 1 ? B.view_24h : tx(B.view_days, { n: d }));
  const bad = S.features.filter((f) => f.health === 'bad').length;
  const secs = [
    { id: 'win', name: B.view_window, sub: B.view_window_sub, aside: win(days) },
    { id: 'chg', name: B.view_changed, sub: B.view_changed_sub, aside: String(changed.length) },
    { id: 'health', name: B.view_health, sub: B.view_health_sub, aside: tx(B.count_bad, { count: bad }) },
  ];
  const ids = secs.map((x) => x.id);
  const [sel, setSel] = useState('win');
  const listRef = useListRef(), det = useRef<HTMLDivElement>(null), jumping = useRef(0);
  const go = useCallback((id: string | null) => {
    if (!id) return;
    setSel(id);
    const el = det.current?.querySelector<HTMLElement>('#wbv-' + id);
    if (el && det.current) { jumping.current = performance.now(); det.current.scrollTo?.({ top: el.offsetTop - 4, behavior: 'smooth' }); }
  }, []);
  const onKey = useWalk(ids, sel, go, listRef);
  // the nav follows the reader's own scroll (not the one a nav press started)
  const onScroll = () => {
    const box = det.current; if (!box || performance.now() - jumping.current < 700) return;
    let best = ids[0]!;
    for (const id of ids) { const el = box.querySelector<HTMLElement>('#wbv-' + id); if (el && el.offsetTop - box.scrollTop < 80) best = id; }
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) best = ids[ids.length - 1]!;
    if (best !== sel) setSel(best);
  };
  return (
    <div className="wb wb-view" onKeyDown={onKey}>
      <div className="wb-panes">
        <div className="wb-list" ref={listRef} role="region" aria-label={B.view_sections}>
          <ul role="listbox" aria-label={B.view_sections}>
            {secs.map((x) => (
              <Row key={x.id} id={x.id} on={sel === x.id} onPick={() => go(x.id)} cls="nav">
                <span className="rt one">{x.name}</span>
                <span className="rm"><span>{x.sub}</span><span>{x.aside}</span></span>
              </Row>
            ))}
          </ul>
          <p className="wb-tip">{B.view_tip}</p>
        </div>
        <div className="wb-detail" ref={det} onScroll={onScroll} aria-label={B.view_settings} role="region">
          <div className="wb-scroll">
            <Sec id="wbv-win" head={B.view_window_head} aside={tx(B.view_n_changed, { count: changed.length })}>
              <div className="wb-seg" role="group" aria-label={B.view_window_head} data-testid="blueprint-view-window">
                {VIEW_WINDOWS.map((d) => (
                  <PressSeg key={d} on={days === d} days={d} k={win(d)} t={d === 1 ? B.view_w1_t : tx(B.view_wn_t, { n: d })} x={d === 1 ? B.view_w1_x : d === 7 ? B.view_w7_x : B.view_w14_x}
                    onPress={() => s.dispatch({ type: 'viewDays', days: d })} />
                ))}
              </div>
              <p className="wb-help">{B.view_window_help}</p>
            </Sec>
            <Sec id="wbv-chg" head={B.view_changed} aside={win(days)}><ViewChanged rows={changed} /></Sec>
            <Sec id="wbv-health" head={B.view_health} aside={day < S.asOf ? day : B.now}><ViewHealth changed={changed.length} /></Sec>
          </div>
        </div>
      </div>
    </div>
  );
}

function PressSeg({ on, days, k, t, x, onPress }: { on: boolean; days: number; k: string; t: string; x: string; onPress: () => void }) {
  return <Press on={on} onClick={onPress} data-days={days}><b>{k}</b><span>{t}</span><small>{x}</small></Press>;
}
