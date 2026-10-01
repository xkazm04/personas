/**
 * L2's body: the zoomed segment unfolded into its own full sub-ring on the
 * left (measured, drawn 1:1, so nothing scales with it), the legend and the
 * items on the right. The figure turns and grows into place as the L1 zoom
 * lands; under reduced motion both halves only fade.
 */
import { useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';

import { Guides } from '../glyphs/Guides';
import { RadialDefs, type RadialIds } from '../glyphs/primitives';
import { RadialFigure } from '../RadialFigure';
import { useCanvasSize } from '../useCanvasSize';

export interface FigureGeo {
  w: number;
  h: number;
  cx: number;
  cy: number;
  R: number;
}

const EASE = [0.22, 1, 0.36, 1] as const;
/** The L2 ring's outer radius never grows past this, however large the canvas. */
const R_MAX = 380;

interface FocusBodyProps {
  panelW: number;
  reduced: boolean;
  figure: (geo: FigureGeo) => ReactNode;
  panel: ReactNode;
}

export function FocusBody({ panelW, reduced, figure, panel }: FocusBodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useCanvasSize(ref, { w: 560, h: 600 });
  const R = Math.max(90, Math.min(Math.min(w, h) / 2 - 14, R_MAX));
  return (
    <div className="rd-focus-body">
      <div ref={ref} className="rd-focus-stage">
        <motion.div
          className="rd-focus-figure"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.72, rotate: -24 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: reduced ? 0.25 : 0.62, delay: reduced ? 0 : 0.2, ease: EASE }}
        >
          {figure({ w, h, cx: w / 2, cy: h / 2, R })}
        </motion.div>
      </div>
      <motion.aside
        className="rd-focus-panel"
        style={{ width: panelW }}
        initial={{ opacity: 0, x: reduced ? 0 : 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.32, delay: reduced ? 0 : 0.38, ease: EASE }}
      >
        {panel}
      </motion.aside>
    </div>
  );
}

interface FocusFigureProps {
  geo: FigureGeo;
  ids: RadialIds;
  /** The hub's headline quantity and what it counts. */
  hub: { value: number | null; unit?: 'ratio' | 'count'; label: string };
  children: ReactNode;
  /** HTML laid over the SVG (direct labels), positioned in the same pixels. */
  overlay?: ReactNode;
  /** Hairline construction circles, as fractions of R. */
  guides: readonly number[];
}

/** The SVG an L2 sub-ring draws in, with its hub disc and the hub's figure on top. */
export function FocusFigure({ geo, ids, hub, children, overlay, guides }: FocusFigureProps) {
  const { w, h, cx, cy, R } = geo;
  const hubR = R * 0.24;
  return (
    <>
      <svg className="rd-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden focusable="false">
        <RadialDefs ids={ids} />
        <Guides cx={cx} cy={cy} R={R} circles={guides} axes={false} />
        {children}
        <circle className="rd-hub-disc" cx={cx} cy={cy} r={hubR} />
        <circle className="rd-hub-inner" cx={cx} cy={cy} r={Math.max(1, hubR - 5)} />
      </svg>
      <div className="rd-focus-hub" style={{ left: cx, top: cy, maxWidth: hubR * 1.9 }}>
        <RadialFigure value={hub.value} unit={hub.unit} className="typo-data-lg text-foreground" />
        <span className="typo-caption">{hub.label}</span>
      </div>
      {overlay}
    </>
  );
}
