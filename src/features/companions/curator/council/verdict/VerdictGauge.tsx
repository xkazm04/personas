// The cover's lead figure: the overall as a 270-degree dial against the
// bar. The fill is the app's identity colour while under the bar (below the
// bar is the normal, advisory state of an uncalibrated council - it is not
// painted red), the stretch still missing to the bar is a dashed amber arc,
// and the bar is a tick across the track. No overall at all is a dashed
// empty dial.
import { useTranslation } from '@/i18n/useTranslation';

import { useScore } from './marks';

const SWEEP = 270;
const START = 135; // degrees, clockwise from +x: the dial opens at the bottom

function polar(c: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
}

function arc(c: number, r: number, from: number, to: number) {
  const a = polar(c, r, START + SWEEP * from);
  const b = polar(c, r, START + SWEEP * to);
  const large = SWEEP * (to - from) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function VerdictGauge({
  overall,
  threshold,
  floorHit,
  size = 200,
}: {
  overall: number | null;
  threshold: number;
  floorHit: boolean;
  size?: number;
}) {
  const { t, tx } = useTranslation();
  const w = t.council.verdict;
  const score = useScore();
  const c = size / 2;
  const r = c - 14;
  const v = overall == null ? null : Math.max(0, Math.min(1, overall));
  const fill = floorHit
    ? 'var(--status-error)'
    : v != null && v >= threshold
      ? 'var(--status-success)'
      : 'var(--primary)';
  const tickIn = polar(c, r - 16, START + SWEEP * threshold);
  const tickOut = polar(c, r + 13, START + SWEEP * threshold);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={overall == null ? w.gauge_none : tx(w.gauge_label, { overall: score(overall), bar: score(threshold) })}
      >
        <path
          d={arc(c, r, 0, 1)}
          fill="none"
          stroke="color-mix(in srgb, var(--foreground) 11%, transparent)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={v == null ? '4 7' : undefined}
        />
        {v != null && v > 0.005 ? (
          <path d={arc(c, r, 0, v)} fill="none" stroke={fill} strokeWidth="14" strokeLinecap="round" />
        ) : null}
        {v != null && v < threshold ? (
          <path
            d={arc(c, r, v, threshold)}
            fill="none"
            stroke="color-mix(in srgb, var(--status-warning) 70%, transparent)"
            strokeWidth="6"
            strokeDasharray="3 5"
          />
        ) : null}
        <line
          x1={tickIn.x.toFixed(2)}
          y1={tickIn.y.toFixed(2)}
          x2={tickOut.x.toFixed(2)}
          y2={tickOut.y.toFixed(2)}
          stroke="var(--foreground)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 pt-2">
        <span className="typo-hero tabular-nums text-foreground">{overall == null ? '-' : score(overall)}</span>
        <span className="typo-body text-muted">{tx(w.gauge_bar, { value: score(threshold) })}</span>
      </div>
    </div>
  );
}
