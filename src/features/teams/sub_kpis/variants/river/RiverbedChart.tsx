// The bed, drawn.
//
// Hand-built SVG rather than a chart library, because the shape IS the
// argument: a stippled dry bed at full declared width, water mirrored around
// a centreline, silt on the banks, and a tick where a week carried no reading
// at all. No chart primitive draws "the absence of a reading" - it draws zero,
// which is the lie this surface exists to stop telling.
import { useId } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { BedPoint, Riverbed } from './riverbed';
import { waterHalfWidth, wetRuns } from './riverbed';

const LAYERS = [
  { key: 'offTrack', color: 'var(--status-error)' },
  { key: 'onTrack', color: 'var(--primary)' },
  { key: 'met', color: 'var(--status-success)' },
] as const;

export function RiverbedChart({ bed, height }: { bed: Riverbed; height: number }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const patternId = useId();
  const points = bed.points;
  const n = Math.max(1, points.length);
  const W = 1000;
  const mid = height / 2;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const half = (p: BedPoint) => waterHalfWidth(p.read, bed.declared) * height;

  /** One stacked layer as a mirrored band, per wet run so gaps stay gaps. */
  const bandPath = (run: BedPoint[], below: (p: BedPoint) => number, upto: (p: BedPoint) => number) => {
    const idx = (p: BedPoint) => points.indexOf(p);
    const top = run.map((p) => {
      const scale = p.read > 0 ? half(p) / p.read : 0;
      return `${x(idx(p)).toFixed(1)},${(mid - upto(p) * scale).toFixed(1)}`;
    });
    const bottom = [...run].reverse().map((p) => {
      const scale = p.read > 0 ? half(p) / p.read : 0;
      return `${x(idx(p)).toFixed(1)},${(mid - below(p) * scale).toFixed(1)}`;
    });
    return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
  };

  const runs = wetRuns(points);

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label={tx(o.river_bed_aria, { declared: bed.declared, dry: bed.dryWeeks })}
    >
      <defs>
        <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeOpacity="0.28" strokeWidth="1" />
        </pattern>
      </defs>

      {/* The dry bed: the whole claim, always at full width. */}
      <rect x="0" y="0" width={W} height={height} fill={`url(#${patternId})`} />
      <rect x="0" y="0" width={W} height={height} fill="none" stroke="var(--card-border)" strokeDasharray="3 3" />

      {runs.map((run, i) => (
        <g key={`run-${i}`}>
          {/* Silt sits outside the verdicts, on the banks. */}
          <path
            d={bandPath(run, (p) => -(p.read / 2), (p) => p.read / 2)}
            fill="var(--muted-foreground)"
            fillOpacity="0.22"
            stroke="var(--muted-foreground)"
            strokeOpacity="0.45"
            strokeDasharray="4 3"
            strokeWidth="1"
          />
          {LAYERS.map((layer, li) => {
            const stackUpto = (p: BedPoint) => {
              const verdicts = p.met + p.onTrack + p.offTrack;
              const taken = LAYERS.slice(0, li + 1).reduce((s, l) => s + p[l.key], 0);
              return verdicts === 0 ? 0 : taken - verdicts / 2;
            };
            const stackBelow = (p: BedPoint) => {
              const verdicts = p.met + p.onTrack + p.offTrack;
              const taken = LAYERS.slice(0, li).reduce((s, l) => s + p[l.key], 0);
              return verdicts === 0 ? 0 : taken - verdicts / 2;
            };
            return (
              <path key={layer.key} d={bandPath(run, stackBelow, stackUpto)} fill={layer.color} fillOpacity="0.85" />
            );
          })}
        </g>
      ))}

      {/* A dry week is a tick on the centreline: present, and empty. */}
      {points.map((p, i) =>
        p.read === 0 ? (
          <line
            key={p.week}
            x1={x(i)}
            y1={mid - 4}
            x2={x(i)}
            y2={mid + 4}
            stroke="var(--muted-foreground)"
            strokeOpacity="0.7"
          />
        ) : null,
      )}

    </svg>
  );
}
