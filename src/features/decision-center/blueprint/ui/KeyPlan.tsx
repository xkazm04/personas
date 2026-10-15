import { useEffect, useRef } from 'react';
import { useSheet } from '../controller/SheetContext';
import { drawKeyPlan } from '../engine/keyplan';
import { useViewLevel } from '../state/viewStore';

/** The key plan (bp render/keyplan.ts): where the camera is in the whole, from L1 down. It follows every frame. */
export function KeyPlan() {
  const s = useSheet();
  const { B } = s.text;
  const lv = useViewLevel(s.view);
  const cv = useRef<HTMLCanvasElement>(null);
  const shown = lv.n >= 1 && !s.ui.sheet;
  useEffect(() => {
    if (!shown) return;
    const draw = () => { if (cv.current && s.engine) drawKeyPlan(cv.current, s.plan.L, s.engine.th, s.engine.cam); };
    const first = requestAnimationFrame(draw);
    const off = s.view.onFrame(draw);
    return () => { cancelAnimationFrame(first); off(); };
  }, [shown, s.view, s.plan, s.engine]);
  if (!shown) return null;
  return (
    <div className="bp-kp" aria-hidden="true">
      <div className="typo-eyebrow">{B.key_plan}</div>
      <canvas ref={cv} />
    </div>
  );
}
