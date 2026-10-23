import { useEffect, useRef } from 'react';
import { useSheet } from '../controller/SheetContext';
import { drawKeyPlan } from '../engine/keyplan';
import { useViewLevel } from '../state/viewStore';

/** The key plan (bp render/keyplan.ts): where the camera is in the whole, from L1 down. It follows every frame; travelled,
 *  the rooms fill by the built share on that date. While the timeline panel is open its own key plan stands instead. */
export function KeyPlan() {
  const s = useSheet();
  const { B } = s.text;
  const lv = useViewLevel(s.view);
  const cv = useRef<HTMLCanvasElement>(null);
  const shown = lv.n >= 1 && !s.ui.sheet && !s.ui.timelineOpen;
  useEffect(() => {
    if (!shown) return;
    const draw = () => { const e = s.engine; if (cv.current && e) drawKeyPlan(cv.current, s.plan.L, e.th, e.cam, undefined, s.work, e.isNow ? undefined : (f) => e.stageOf(f)); };
    const first = requestAnimationFrame(draw);
    const off = s.view.onFrame(draw);
    return () => { cancelAnimationFrame(first); off(); };
  }, [shown, s.view, s.plan, s.engine, s.work, s.ui.asOf]);
  if (!shown) return null;
  return (
    <div className="bp-kp" aria-hidden="true">
      <div className="typo-eyebrow">{B.key_plan}</div>
      <canvas ref={cv} />
    </div>
  );
}
