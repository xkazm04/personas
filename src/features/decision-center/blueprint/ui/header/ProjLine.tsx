import { useLayoutEffect, useRef } from 'react';
import '../../styles/page-switch.css';
import { useSheet } from '../../controller/SheetContext';
import { openFindings } from '../../model/counts';
import { Press } from '../Press';
import { ChangesChip } from './ChangesChip';

/** The sheet number the title line prints: G-001 for the General arrangement, the lens's short code for a lens sheet. */
export function sheetNumber(short: string | null): string {
  return short ?? 'G-001';
}

/**
 * bp's page switch (Header.tsx PageSwitch, page-switch.css): DRAWING SET | LEDGER n, 18 px, the pressed side ink-filled,
 * the amber count of open (proposed) findings on the LEDGER side. It dispatches `page`; L does the same.
 */
function PageSwitch() {
  const s = useSheet();
  const { B } = s.text;
  const open = openFindings(s.work);
  return (
    <span className="pgsw" role="group" aria-label={B.lg_page_switch} data-testid="blueprint-page-switch">
      <Press on={s.ui.page === 'plan'} onClick={() => s.dispatch({ type: 'page', page: 'plan' })}>{B.drawing_set}</Press>
      <Press on={s.ui.page === 'ledger'} onClick={() => s.dispatch({ type: 'page', page: 'ledger' })} data-testid="blueprint-page-ledger">
        {B.lg_ledger}{open ? <b>{open}</b> : null}
      </Press>
    </span>
  );
}

/**
 * The title line (bp Header ProjLine): "DRAWING SET · sheet G-001 · General arrangement", 12 px mono uppercase. Too
 * narrow for the whole line, the sheet's title drops first, then the sheet itself (the active lens tab names it too);
 * measured on resize and when the sheet changes (bp's data-fit, Header.tsx:278-307). It opens with bp's page switch,
 * DRAWING SET | LEDGER n (PageSwitch). The last thing the sheet said rides at the end, as the live region.
 */
export function ProjLine() {
  const s = useSheet();
  const { B } = s.text;
  const L = s.ui.lens === 'general' ? null : s.plan.LENS[s.ui.lens] ?? null;
  const no = sheetNumber(L ? L.short : null), title = L ? L.name : B.general_arrangement;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current, sheet = el?.querySelector<HTMLElement>('.pj-sheet');
    if (!el || !sheet) return;
    const fit = () => {
      for (const f of ['0', '1', '2']) { el.dataset.fit = f; if (sheet.scrollWidth <= sheet.clientWidth) return; }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [no, title]);
  return (
    <div className="bp-l1" ref={ref}>
      <PageSwitch />
      <ChangesChip />
      <span className="pj-sheet"> {'·'} <b><span className="pj-no">{B.sheet} {no}</span><span className="pj-ttl"> {'·'} {title}</span></b></span>
      <span className="bp-say" role="status" aria-live="polite" key={s.ui.say?.key ?? 0}>{s.ui.say?.text ?? ''}</span>
    </div>
  );
}
