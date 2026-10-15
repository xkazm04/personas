import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { f1 } from './noise';
import type { Scene } from './useScene';

/**
 * The map's furniture above the drawing: the cartouche (what this map is), the scale statement
 * (what the river's width means and that every session ends somewhere on it), the compass, the
 * held-back note and the arrival's skip hint. Static per scene.
 */
export const Overlay = memo(function Overlay({ scene, arriving }: { scene: Scene; arriving: boolean }) {
  const { t, tx } = useTranslation();
  const w = t.companions.process.watershed;
  const { g, totals } = scene;
  const U = g.U;
  const scalePos = g.stacked ? { left: 22 * U, top: 70 * (g.fs / 16.5) } : { left: 20 * U + g.cartW };
  return (
    <>
      <div className="ws-cartouche">
        <div className="ws-cart-title">{scene.cartTitle}</div>
        <div className="ws-cart-sub">{scene.cartSub}</div>
      </div>
      <div className="ws-scale ws-l1" style={scalePos}>
        <div className="ws-scale-glyph" style={{ height: Math.min(44 * U, g.srcW / 2) }} />
        <div className="ws-scale-txt">
          <div>{w.scale_width} <b>{tx(w.scale_sessions, { count: g.n })}</b></div>
          <div>{tx(w.scale_conserved, totals)}</div>
        </div>
      </div>
      <div className="ws-compass ws-l1" aria-hidden="true">
        <svg viewBox="-30 -30 60 60" width="100%" height="100%">
          <circle r="20" fill="none" stroke="currentColor" strokeOpacity=".35" />
          <circle r="26" fill="none" stroke="currentColor" strokeOpacity=".18" strokeDasharray="1 3" />
          <path d="M0 -24 L5 0 L0 24 L-5 0Z" fill="currentColor" fillOpacity=".25" />
          <path d="M0 -24 L5 0 L-5 0Z" className="ws-compass-n" />
          <path d="M-24 0 L0 4 L24 0 L0 -4Z" fill="currentColor" fillOpacity=".2" />
          <path d="M8 -11 V-19 L13 -11 V-19" className="ws-compass-t" />
        </svg>
      </div>
      {scene.labels.dropped > 0 && (
        <div className="ws-note ws-l1" style={{ left: f1(g.xA), top: f1(g.Mb - 26 * U) }}>
          {tx(w.held_back, { count: scene.labels.dropped })}
        </div>
      )}
      <div className="ws-keys" aria-hidden="true">{w.keys}</div>
      {arriving && <div className="ws-skip" aria-hidden="true">{w.skip}</div>}
    </>
  );
});
