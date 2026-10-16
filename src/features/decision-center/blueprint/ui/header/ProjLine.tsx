import { useLayoutEffect, useRef } from 'react';
import { useSheet } from '../../controller/SheetContext';

/** The sheet number the title line prints: G-001 for the General arrangement, the lens's short code for a lens sheet. */
export function sheetNumber(short: string | null): string {
  return short ?? 'G-001';
}

/**
 * The title line (bp Header ProjLine): "DRAWING SET · sheet G-001 · General arrangement", 12 px mono uppercase. Too
 * narrow for the whole line, the sheet's title drops first, then the sheet itself (the active lens tab names it too);
 * measured on resize and when the sheet changes (bp's data-fit, Header.tsx:278-307). The DRAWING SET | LEDGER page
 * switch arrives in Stage B: only its DRAWING SET segment is drawn. The last thing the sheet said rides at the end,
 * as the live region.
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
      <span className="pgsw"><span>{B.drawing_set}</span></span>
      <span className="pj-sheet"> {'·'} <b><span className="pj-no">{B.sheet} {no}</span><span className="pj-ttl"> {'·'} {title}</span></b></span>
      <span className="bp-say" role="status" aria-live="polite" key={s.ui.say?.key ?? 0}>{s.ui.say?.text ?? ''}</span>
    </div>
  );
}
