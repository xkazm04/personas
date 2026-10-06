/**
 * The leader: a hairline from an open control surface back to the gate it
 * came from on the spine, so the decision visibly belongs to that lane at that
 * moment. Measured after layout and written straight to the line's style (no
 * state, so it never re-renders the layer); hidden when either end is missing.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useLayoutEffect, useRef } from 'react';

export function Leader({ gateId, revision }: { gateId: string; revision: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const line = ref.current;
    // The layer, found from the line itself: a parent's ref is not attached yet
    // when this mounts in the same commit as the layer.
    const root = line?.closest<HTMLElement>('.r5b');
    if (!line || !root) return;
    const place = () => {
      const surface = root.querySelector<HTMLElement>('[data-testid=companion-r5b-surface]');
      const gate = root.querySelector<HTMLElement>(`[data-testid="companion-r5b-gate-${CSS.escape(gateId)}"]`);
      if (!surface || !gate) {
        line.style.opacity = '0';
        return;
      }
      const lr = root.getBoundingClientRect();
      const s = surface.getBoundingClientRect();
      const g = gate.getBoundingClientRect();
      const y = Math.min(s.bottom - 24, Math.max(s.top + 24, g.top + g.height / 2));
      line.style.opacity = '1';
      line.style.left = `${s.right - lr.left}px`;
      line.style.top = `${y - lr.top}px`;
      line.style.width = `${Math.max(0, g.left - s.right + 4)}px`;
    };
    // After the surface's entrance has laid out, and again on resize.
    const raf = requestAnimationFrame(place);
    const t = setTimeout(place, 400);
    const ro = new ResizeObserver(place);
    ro.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
    };
  }, [gateId, revision]);
  return <span ref={ref} className="r5b-leader r5b-fade" style={{ opacity: 0 }} aria-hidden />;
}
