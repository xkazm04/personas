// bp's expanded timeline (PORTED from bp src/components/BaseBar.tsx BaseBar + timeline.css #tlpanel): a 96 px panel that
// slides up OVER the plan (it never moves the plan) with the key plan, the clock (the as-of date) and the revisions
// chart, whose handle travels in time (`ui.asOf`). Mounted by BlueprintSheet while `ui.timelineOpen` (T, or the strip's
// TIMELINE press); T again, or Esc, closes it through the sheet's keymap.
// EDIT (port): bp's motion/react stagger is a CSS entrance here (reduced motion: none); its simulated hour and speed
// controls are simulation and are not brought.
import { useSheet } from '../../controller/SheetContext';
import { Clock } from './Clock';
import { PanelKeyPlan } from './PanelKeyPlan';
import { Revisions } from './Revisions';

export function TimelinePanel() {
  const { B } = useSheet().text;
  return (
    <section id="bp-tlpanel" className="bp-tlpanel" aria-label={B.timeline} data-testid="blueprint-timeline-panel">
      <PanelKeyPlan />
      <div className="tl-timebox">
        <Clock />
        <Revisions />
      </div>
    </section>
  );
}
