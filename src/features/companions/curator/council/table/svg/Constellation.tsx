// The constellation: the stars this council lands on, in their real relative
// positions in the galaxy, so the header shows WHERE the subject sits rather
// than only how many places it touches.
//
// Each dot carries that star's council mark. A star the registry does not
// hold is simply absent - the shape is drawn from what is there, never from
// a placeholder position.
import type { CouncilMark, SubjectNode } from '../../galaxy/engine/types';

const MARK_FILL: Record<CouncilMark, string> = {
  approved: 'var(--status-success)',
  pending: 'var(--status-pending)',
  rejected: 'var(--status-error)',
  none: 'var(--muted-dark)',
};

export function Constellation({
  stars,
  width = 170,
  height = 86,
}: {
  stars: SubjectNode[];
  width?: number;
  height?: number;
}) {
  if (stars.length === 0) return null;

  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of stars) {
    x0 = Math.min(x0, s.x);
    x1 = Math.max(x1, s.x);
    y0 = Math.min(y0, s.y);
    y1 = Math.max(y1, s.y);
  }
  const pad = 14;
  const k = Math.min((width - pad * 2) / Math.max(1, x1 - x0), (height - pad * 2) / Math.max(1, y1 - y0));
  const points = stars.map((s) => ({
    x: width / 2 + (s.x - (x0 + x1) / 2) * k,
    y: height / 2 + (s.y - (y0 + y1) / 2) * k,
    star: s,
  }));
  const cx = points.reduce((n, p) => n + p.x, 0) / points.length;
  const cy = points.reduce((n, p) => n + p.y, 0) / points.length;
  // Sorted by bearing so the hull reads as one shape rather than a scribble.
  points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="flex-none rounded-card border border-border bg-secondary/[0.04]"
    >
      <polygon
        points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="var(--primary)"
        strokeOpacity="0.5"
        strokeDasharray="3 4"
      />
      {points.map((p) => (
        <circle
          key={p.star.slug}
          cx={p.x.toFixed(1)}
          cy={p.y.toFixed(1)}
          r="4.5"
          fill={MARK_FILL[p.star.mark]}
        />
      ))}
    </svg>
  );
}

export default Constellation;
