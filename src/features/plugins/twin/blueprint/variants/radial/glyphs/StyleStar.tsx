/**
 * A channel's eight style dimensions as a tiny radar star: one axis per
 * dimension (STYLE_DIMENSIONS order, clockwise from 12), each on the declared
 * 1..5 domain, inside a faint octagon that marks 5. No stored style draws a
 * small dashed ring ("no style"), never an empty star.
 */
import type { TwinStyleDims } from '@/lib/bindings/TwinStyleDims';

import { STYLE_DIMENSIONS } from '../../../../setup/style/styleContract';
import { polar, polygonPoints } from '../radialGeometry';
import { DIM_MAX, clamp01 } from '../radialModel';

interface StyleStarProps {
  x: number;
  y: number;
  r: number;
  dims: TwinStyleDims | null;
  /** Draw the axis spokes (the L2 key star). */
  axes?: boolean;
}

export function StyleStar({ x, y, r, dims, axes }: StyleStarProps) {
  if (!dims) return <circle className="rd-star-none" cx={x} cy={y} r={Math.max(2.5, r * 0.45)} data-dims="none" />;
  const step = 360 / STYLE_DIMENSIONS.length;
  const frame = STYLE_DIMENSIONS.map((_, k) => polar(x, y, r, k * step));
  const shape = STYLE_DIMENSIONS.map((d, k) => polar(x, y, r * clamp01(dims[d] / DIM_MAX), k * step));
  return (
    <g data-dims="set">
      <polygon className="rd-star-frame" points={polygonPoints(frame)} />
      {axes && frame.map((p, k) => <line key={k} className="rd-star-axis" x1={x} y1={y} x2={p.x} y2={p.y} />)}
      <polygon className="rd-star" points={polygonPoints(shape)} />
    </g>
  );
}
