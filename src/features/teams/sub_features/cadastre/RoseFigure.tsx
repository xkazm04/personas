// The rating rose (owner: "the design of pie/multidimensional rating is
// superior and should be preserved"): five wedges as wide as their weights and
// as long as their scores, a dashed bar ring at the threshold, a floor band in
// each petal, earlier rounds as faint growth rings, a hatched ghost petal for a
// null score, and the scenario envelope as a numbered outer ring. Drawn at its
// real pixel size; the radius is solved from the measured labels.
import { useId, useRef } from 'react';

import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import { formatNumeric, formatPercent } from '@/lib/utils/formatters';

import { FEATURE_THRESHOLD } from '../featureRules';
import type { TFeatures } from '../featuresModel';
import type { CadRow } from './cadastreModel';
import type { Measure } from './cadastreLayout';
import { arcPath, foldOf, roseDims, roseLabels, roseRadius, wedge } from './roseGeometry';

export interface RoseFigureProps {
  r: CadRow;
  measure: Measure;
  dimName: (dim: string) => string;
  hotScn: number | null;
  onHotScn: (i: number | null) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

export function RoseFigure({ r, measure, dimName, hotScn, onHotScn, t, tx, language }: RoseFigureProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(boxRef);
  const uid = useId().replace(/:/g, '');
  const { feature } = r.row;
  const c = feature.council;
  const f2 = (v: number) => formatNumeric(v, 'plain', { language, precision: 2 });
  const pct = (v: number) => formatPercent(v, { fromRatio: true, precision: 0, language });
  const W = Math.floor(size.width);
  const H = Math.floor(Math.min(size.height, 760));
  const dims = roseDims(feature);
  const scen = feature.scenarios;
  const labels = roseLabels(dims, dimName, (d) => (d.score == null ? (d.ghost ? t.cadastre_not_judged : t.not_measured) : `${f2(d.score)}${d.floorHit ? ` ${t.cadastre_floor}` : ''}`), pct, measure);
  const R = W > 0 && H > 0 ? roseRadius(labels, W, H, scen.length > 0) : 0;
  const cx = W / 2;
  const cy = H / 2;
  const r0 = R * 0.24;
  const rad = (s: number) => r0 + s * (R - r0);
  const hatch = `cad-hatch-${uid}`;
  const hatchFine = `cad-hatchf-${uid}`;
  const grad = (id: string, col: string) => (
    <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={R}>
      <stop offset={(r0 / R).toFixed(2)} style={{ stopColor: col, stopOpacity: 0.16 }} />
      <stop offset="1" style={{ stopColor: col, stopOpacity: 0.78 }} />
    </radialGradient>
  );
  let a = -Math.PI / 2;
  const lr = R + (scen.length ? 46 : 18);

  return (
    <div ref={boxRef} className="rosebox">
      {R > 0 ? (
        <svg className="bigrose" data-role="cad-rose" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx(t.cadastre_rose_aria, { name: feature.name, overall: c?.overall == null ? t.not_measured : f2(c.overall) })}>
          <defs>
            {grad(`${uid}-tone`, 'var(--tone)')}
            {grad(`${uid}-hit`, 'var(--c-trouble)')}
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" style={{ fill: 'var(--hatch-bg)' }} />
              <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--hatch-ink)', strokeWidth: 2 }} />
            </pattern>
            <pattern id={hatchFine} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" style={{ stroke: 'var(--ink-on-tone)', strokeWidth: 1.2, strokeOpacity: 0.55 }} />
            </pattern>
          </defs>
          <circle cx={cx} cy={cy} r={R} className="r-guide" />
          {[0.25, 0.5, 0.75].map((g) => <circle key={g} cx={cx} cy={cy} r={rad(g).toFixed(1)} className="r-grid" />)}
          {feature.history.slice(0, -1).map((h) => (h.overall != null ? <circle key={h.roundNo} cx={cx} cy={cy} r={rad(h.overall).toFixed(1)} className="r-growth" /> : null))}
          {dims.map((d, i) => {
            const span = d.weight * Math.PI * 2;
            const a0 = a + 0.018;
            const a1 = a + span - 0.018;
            a += span;
            if (d.score == null) return <path key={d.dimension} className="petal ghost" data-role="cad-petal" style={{ ['--i' as string]: i, fill: `url(#${hatch})` }} d={wedge(cx, cy, r0, R, a0, a1)} />;
            return (
              <g key={d.dimension}>
                <path className="petal" data-role="cad-petal" style={{ ['--i' as string]: i, fill: `url(#${uid}-${d.floorHit ? 'hit' : 'tone'})` }} d={wedge(cx, cy, r0, rad(d.score), a0, a1)} />
                <path className="petal-edge" style={{ ['--i' as string]: i, ['--pc' as string]: d.floorHit ? 'var(--c-trouble)' : 'var(--tone)' }} d={arcPath(cx, cy, rad(d.score), a0, a1)} />
                {d.floor != null ? <path className={`floor${d.floorHit ? ' hit' : ''}`} data-role="cad-floor" d={wedge(cx, cy, rad(d.floor) - 1.5, rad(d.floor) + 1.5, a0 + 0.02, a1 - 0.02)} /> : null}
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={rad(FEATURE_THRESHOLD).toFixed(1)} className="r-bar" />
          <text x={cx + 5} y={(cy - rad(FEATURE_THRESHOLD) - 5).toFixed(1)} className="r-barl">{tx(t.cadastre_bar, { value: f2(FEATURE_THRESHOLD) })}</text>
          {c?.state === 'approved_drifted' ? <circle cx={cx} cy={cy} r={R + 4} className="r-drift" /> : null}
          {r.row.running ? <circle className="pulse r-running motion-reduce:animate-none" cx={cx} cy={cy} r={R + 4} /> : null}
          <circle cx={cx} cy={cy} r={r0} className="r-hub" />
          {c?.overall != null ? (
            <text x={cx} y={cy + 10} textAnchor="middle" className="r-ov" style={{ fontSize: `${Math.max(26, r0 * 0.62).toFixed(0)}px` }}>{f2(c.overall)}</text>
          ) : (
            <>
              <text x={cx} y={cy - 2} textAnchor="middle" className="r-hubs">{c ? t.cadastre_hub_nm_a : t.cadastre_hub_never_a}</text>
              <text x={cx} y={cy + 16} textAnchor="middle" className="r-hubs">{c ? t.cadastre_hub_nm_b : t.cadastre_hub_never_b}</text>
            </>
          )}
          {scen.map((s, i) => {
            const e1 = R + 10;
            const e2 = R + 34;
            const g2 = 0.035;
            const b0 = -Math.PI / 2 + (i * 2 * Math.PI) / scen.length + g2 / 2;
            const b1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / scen.length - g2 / 2;
            const e = foldOf(feature, s.slug);
            const m = (b0 + b1) / 2;
            const mr = (e1 + e2) / 2;
            return (
              <g key={s.id} onMouseEnter={() => onHotScn(i)} onMouseLeave={() => onHotScn(null)}>
                <path className={`envcell e-${e}${hotScn === i ? ' hot' : ''}`} data-role="cad-envcell" d={wedge(cx, cy, e1, e2, b0, b1)} style={e === 'unmeasured' ? { fill: `url(#${hatch})` } : undefined} />
                {s.latest?.advisory && (e === 'holds' || e === 'weak') ? <path d={wedge(cx, cy, e1, e2, b0, b1)} fill={`url(#${hatchFine})`} pointerEvents="none" /> : null}
                <text x={(cx + mr * Math.cos(m)).toFixed(1)} y={(cy + mr * Math.sin(m) + 5).toFixed(1)} textAnchor="middle" className={`envn${e === 'holds' || e === 'weak' ? ' on' : ''}`}>{i + 1}</text>
              </g>
            );
          })}
          {labels.map((l) => {
            const x = cx + lr * Math.cos(l.mid);
            const y = cy + lr * Math.sin(l.mid);
            const anchor = Math.cos(l.mid) > 0.25 ? 'start' : Math.cos(l.mid) < -0.25 ? 'end' : 'middle';
            const dy = Math.sin(l.mid) > 0.3 ? 12 : Math.sin(l.mid) < -0.3 ? -10 : 2;
            return (
              <g key={l.d.dimension}>
                <text x={x.toFixed(1)} y={(y + dy).toFixed(1)} textAnchor={anchor} className="r-lab">{l.name}</text>
                <text x={x.toFixed(1)} y={(y + dy + 18).toFixed(1)} textAnchor={anchor} className={`r-val${l.d.score == null ? ' nm' : l.d.floorHit ? ' hit' : ''}`}>
                  {l.value}
                  <tspan className="r-w">{`  ${l.weight}`}</tspan>
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
