// bp's rail flyout (PORTED from bp src/components/Dock.tsx:157-209, the flyout host): a panel over the plan to the
// rail's left, one at a time. Its header carries the item's glyph in its tone, the title in caps and an Esc chip; the
// body is a wide workbench (Agents, Plan with the Legend, View). Mounted by BlueprintSheet while `ui.flyout` is set:
// the item again, the Esc ladder, the chip or a press outside the panel and the rail closes it, and focus goes back to
// the item that opened it. It springs in from the right and staggers its blocks in; reduced motion skips both.
// It reports its measured width on the plan (flyRoom.ts; 0 while closed or leaving), which the canvas takes as the safe
// area's right inset, so the drawing narrows to the room left and the camera re-fits (bp's Dock reports it to
// setFlyoutWidth, which there only keeps plan overlays clear). The sheet mounts it inside AnimatePresence: it springs
// out to the right when closed, and reduced motion skips both.
import '../../styles/workbench.css';
import '../../styles/legend.css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useSheet } from '../../controller/SheetContext';
import { sheetNumber } from '../header/ProjLine';
import { Press } from '../Press';
import { setFlyRoom } from '../flyRoom';
import { RAIL_GLYPH } from './glyphs';
import { AgentsPanel } from './panels/AgentsPanel';
import { PlanPanel } from './panels/PlanPanel';
import { ViewPanel } from './panels/ViewPanel';

export function Flyout() {
  const s = useSheet();
  const { B, tx } = s.text;
  const reduce = useReducedMotion();
  const open = s.ui.flyout;
  // while it leaves, the panel keeps the item it showed; the room it took is given back at once (below)
  const held = useRef(open);
  if (open) held.current = open;
  const k = held.current;
  const fly = useRef<HTMLElement>(null), rail = useRef<Element | null>(null);
  const close = () => s.dispatch({ type: 'flyout', id: null });
  useEffect(() => { rail.current = document.querySelector('[data-testid="blueprint-rail"]'); }, []);
  // an Esc or a press outside steps back one rung only: under a dialog or an armed build, the ladder takes that step
  useClickOutside([fly, rail], !!open, () => { if (!s.ui.overlay && !s.ui.armed) close(); });
  // closing hands focus back to the item that opened it (when focus was inside the flyout)
  useLayoutEffect(() => {
    const el = fly.current, opened = open;
    return () => {
      const a = document.activeElement;
      if (!a || a === document.body || el?.contains(a)) document.querySelector<HTMLElement>(`[data-testid="blueprint-rail"] [data-k="${opened}"]`)?.focus({ preventScroll: true });
    };
  }, [open]);
  // the measured width is the room the plan gives up; closing (or leaving) gives it back
  useLayoutEffect(() => {
    const el = fly.current, plan = el?.closest('.bp-plan') ?? null;
    if (!open || !el || !plan) return;
    setFlyRoom(plan, el.offsetWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFlyRoom(plan, el.offsetWidth));
    ro.observe(el);
    return () => { ro.disconnect(); setFlyRoom(plan, 0); };
  }, [open]);
  if (!k) return null;
  const L = s.ui.lens === 'general' ? null : s.plan.LENS[s.ui.lens] ?? null;
  const title = k === 'agents' ? tx(B.fly_agents_title, { running: s.work.activeRuns, runs: s.work.runs.length })
    : k === 'plan' ? tx(B.fly_plan_title, { sheet: sheetNumber(L ? L.short : null) }) : B.fly_view_title;
  return (
    <motion.section ref={fly} id="bp-flyout" className="bp-fly wide" role="region" aria-labelledby="bp-flyout-h" data-k={k} data-testid="blueprint-flyout"
      initial={reduce ? false : { opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: 22, transition: { duration: 0.16, ease: 'easeIn' } }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
      <header className={'fh t-' + (k === 'agents' ? 'mint' : 'ink')}>
        <span className="g" aria-hidden="true">{RAIL_GLYPH[k]}</span>
        <h2 id="bp-flyout-h">{title}</h2>
        <Press tone="x" onClick={close} aria-label={B.fly_close}>{B.dlg_esc}</Press>
      </header>
      <div className={'fb' + (reduce ? ' still' : '')} key={k} tabIndex={-1}>
        {k === 'agents' ? <AgentsPanel /> : k === 'plan' ? <PlanPanel /> : <ViewPanel />}
      </div>
    </motion.section>
  );
}
