// PROTOTYPE ROUND (spark council-readout), direction C. One council's
// overall as a bullet chart: the scale is 0..1, the background band is the
// share of the council's weight that was MEASURED (coverage), the hatched
// rest is what nobody measured, the bar is the overall, and the tall tick is
// the bar it has to clear. A lite round draws its bar hollow and dashed.
import { useId } from 'react';

import { overallTone } from './tableModel';

const H = 28;
const TRACK_Y = 5;
const TRACK_H = 18;
const BAR_H = 8;

export function BulletFigure({
  overall,
  coverage,
  threshold,
  lite,
  width,
  label,
}: {
  overall: number | null;
  coverage: number | null;
  threshold: number;
  lite: boolean;
  width: number;
  label: string;
}) {
  const hatch = `bt-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const x = (v: number) => Math.max(0, Math.min(1, v)) * width;
  const covX = coverage == null ? 0 : x(coverage);
  const tone = overall == null ? null : overallTone(overall, threshold);
  const barW = overall == null ? 0 : Math.max(2, x(overall));
  const tickX = x(threshold);

  return (
    <svg className="bt-fig" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label}>
      <defs>
        <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="bt-fig__hatchline" />
        </pattern>
      </defs>
      {/* Not measured: the whole scale, hatched, under the measured band. */}
      <rect x={0} y={TRACK_Y} width={width} height={TRACK_H} rx={3} fill={`url(#${hatch})`} className="bt-fig__rest" />
      {covX > 0 && <rect x={0} y={TRACK_Y} width={covX} height={TRACK_H} rx={3} className="bt-fig__band" />}
      {tone && (
        <rect
          x={lite ? 1 : 0}
          y={(H - BAR_H) / 2}
          width={lite ? Math.max(1, barW - 2) : barW}
          height={BAR_H}
          rx={2}
          className={`bt-fig__bar is-${tone}${lite ? ' is-lite' : ''}`}
        />
      )}
      <line x1={tickX} x2={tickX} y1={1} y2={H - 1} className="bt-fig__tick" />
    </svg>
  );
}

export default BulletFigure;
