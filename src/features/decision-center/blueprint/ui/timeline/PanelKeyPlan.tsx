import { useEffect, useRef } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { drawKeyPlan, keyPlanWorld } from '../../engine/keyplan';
import { Press } from '../Press';
import { keyPlanFrac } from './scrub';

/**
 * The panel's key plan (bp BaseBar KeyPlanBox): the whole site at 164 px with the camera's view as an amber box and the
 * zoom against the home view (x1.0), redrawn every frame; a press moves the camera there (a keyboard press: the centre).
 * Travelled, the rooms fill by the built share on that date.
 */
export function PanelKeyPlan() {
  const s = useSheet(), { B } = s.text;
  const cv = useRef<HTMLCanvasElement>(null), zoom = useRef<HTMLSpanElement>(null);
  const { engine, plan, work, view } = s;
  useEffect(() => {
    const draw = () => {
      if (!cv.current || !engine) return;
      drawKeyPlan(cv.current, plan.L, engine.th, engine.cam, undefined, work, engine.isNow ? undefined : (f) => engine.stageOf(f));
      const z = '×' + (engine.cam.k / engine.cam.HOME.k).toFixed(1);
      if (zoom.current && zoom.current.textContent !== z) zoom.current.textContent = z;
    };
    const first = requestAnimationFrame(draw);
    const off = view.onFrame(draw);
    return () => { cancelAnimationFrame(first); off(); };
  }, [engine, plan, work, view, s.ui.asOf]);
  const press = (e: React.MouseEvent<HTMLButtonElement>) => {
    const c = cv.current;
    if (!c || !engine) return;
    const r = c.getBoundingClientRect(), [fx, fy] = keyPlanFrac(e.clientX, e.clientY, r, e.detail);
    const w = keyPlanWorld(plan.L, r.width, r.height, fx, fy);
    engine.cam.flyTo({ x: w.x, y: w.y, k: engine.cam.k });
  };
  return (
    <Press tone="tl-kp" aria-label={B.tl_kp_label} onClick={press}>
      <span className="lab"><span>{B.key_plan}</span><span ref={zoom} /></span>
      <canvas ref={cv} aria-hidden="true" />
    </Press>
  );
}
