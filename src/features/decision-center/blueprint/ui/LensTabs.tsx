import { useEffect, useRef, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useSheet } from '../controller/SheetContext';
import { sheetNumber } from './header/ProjLine';
import { Press } from './Press';

/**
 * The lens tabs (bp Header LensTabs, blueprint.css:51-66): a ruled box with a 2 px ink-2 floor; one tab per sheet as
 * its short code (G-001, BIZ, DES ...), the questions waiting under it in amber and its digit key; the full name rides
 * a tooltip. The selected tab is filled 14% ink and a 4 px lens underline slides between tabs (instant under reduced
 * motion). Two rows when the product has custom PROJECT lenses: General and the built-in lenses on top, the custom
 * ones below behind a CUSTOM cap, each tab half height. Arrows, Home and End move between tabs and select (roving
 * focus); a narrow plan scrolls the strip and keeps the selected tab in it. A toolbar of pressed buttons, not a
 * tablist: the sheets switch the drawing's lens, they do not show and hide panels of their own.
 */
export function LensTabs() {
  const s = useSheet();
  const { B, tx } = s.text;
  const reduce = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const ids = ['general', ...s.plan.lenses.map((l) => l.id)];
  const custom = new Set(s.plan.lenses.filter((l) => l.source !== 'builtin').map((l) => l.id));
  const rows = [ids.filter((k) => !custom.has(k)), ids.filter((k) => custom.has(k))];
  const set = (id: string) => { s.dispatch({ type: 'lens', id }); if (s.ui.sheet) s.dispatch({ type: 'sheetLens', id }); };
  const waitingBy = (id: string) => s.work.items.filter((p) => p.status === 'proposed' && p.lens === id).length;

  useEffect(() => {
    const el = strip.current, b = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !b || el.scrollWidth <= el.clientWidth) return;
    if (b.offsetLeft < el.scrollLeft) el.scrollLeft = b.offsetLeft;
    else if (b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = b.offsetLeft + b.offsetWidth - el.clientWidth;
  }, [s.ui.lens]);

  const onKey = (e: KeyboardEvent) => {
    const i = Math.max(0, ids.indexOf(s.ui.lens)), n = ids.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    set(ids[j]!);
    strip.current?.querySelector<HTMLElement>(`[data-lens="${CSS.escape(ids[j]!)}"]`)?.focus();
  };

  const tab = (id: string) => {
    const i = ids.indexOf(id), L = id === 'general' ? null : s.plan.LENS[id];
    const name = L ? L.name : B.general_arrangement, n = L ? waitingBy(id) : 0, on = s.ui.lens === id;
    const label = n ? tx(B.tab_waiting, { name, count: n }) : name;
    return (
      <Tooltip key={id} content={label} placement="bottom">
        <Press tone="bp-tab-b" on={on} tabIndex={on ? 0 : -1} aria-label={label} onClick={() => set(id)} data-lens={id}>
          <span className="no">{sheetNumber(L ? L.short : null)}{n ? <b className="ct">{n}</b> : null}</span>
          {i < 9 && <span className="kb" aria-hidden="true">{i + 1}</span>}
          {on && <motion.span layoutId="bp-lens-uline" className="uline" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }} />}
        </Press>
      </Tooltip>
    );
  };
  return (
    <div className="bp-sheets-col" role="toolbar" aria-label={B.sheets} ref={strip} onKeyDown={onKey} data-rows={rows[1]!.length ? 2 : 1} data-testid="blueprint-lens-tabs">
      <div className="tab-row">{rows[0]!.map(tab)}</div>
      {rows[1]!.length > 0 && <div className="tab-row custom" data-testid="blueprint-custom-lenses"><span className="tab-cap" aria-hidden="true">{B.custom}</span>{rows[1]!.map(tab)}</div>}
    </div>
  );
}
