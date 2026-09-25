// The deed's three figures: the coverage ring with its floor tick, the round
// trend against the bar, and the 30-day spend. A figure the board does not
// carry says "not measured" (spend today), never a zero.
import { formatNumeric, formatPercent } from '@/lib/utils/formatters';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';

import { FEATURE_COVERAGE_FLOOR, FEATURE_THRESHOLD } from '../featureRules';
import type { TFeatures } from '../featuresModel';

interface Props {
  feature: BoardFeature;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

function Ring({ v, col, label, text }: { v: number; col: string; label: string; text: string }) {
  const size = 76;
  const r = size / 2 - 6;
  const C = 2 * Math.PI * r;
  const h = size / 2;
  const fa = -Math.PI / 2 + FEATURE_COVERAGE_FLOOR * 2 * Math.PI;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle cx={h} cy={h} r={r} className="rg-trk" />
      <circle cx={h} cy={h} r={r} className="rg-val" style={{ stroke: col }} strokeDasharray={`${(C * v).toFixed(1)} ${C.toFixed(1)}`} transform={`rotate(-90 ${h} ${h})`} />
      <line x1={h + (r - 8) * Math.cos(fa)} y1={h + (r - 8) * Math.sin(fa)} x2={h + (r + 8) * Math.cos(fa)} y2={h + (r + 8) * Math.sin(fa)} className="rg-tick" />
      <text x={h} y={h + 5} textAnchor="middle" className="rg-t">{text}</text>
    </svg>
  );
}

function Rounds({ feature, t, tx, language }: Props) {
  const h = feature.history;
  const W = 250;
  const H = 104;
  const x0 = 26;
  const x1 = W - 20;
  const y = (v: number) => 16 + ((1 - Math.max(0.35, v)) / 0.65) * (H - 46);
  const xs = (i: number) => x0 + (i * (x1 - x0)) / 2;
  const f2 = (v: number) => formatNumeric(v, 'plain', { language, precision: 2 });
  const pts = h.slice(0, 3).map((r, i) => (r.overall != null ? `${xs(i)},${y(r.overall)}` : null)).filter((p): p is string => p != null);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.rounds_label}>
      {pts.length > 1 ? <polyline points={pts.join(' ')} className="rd-line" /> : null}
      <line x1={x0 - 14} x2={x1 + 14} y1={y(FEATURE_THRESHOLD)} y2={y(FEATURE_THRESHOLD)} className="rd-bar" />
      <text x={x1 + 16} y={y(FEATURE_THRESHOLD) - 6} textAnchor="end" className="rd-ax">{t.cadastre_bar_word}</text>
      {[0, 1, 2].map((i) => {
        const r = h[i];
        const x = xs(i);
        return (
          <g key={i}>
            <text x={x} y={H - 4} textAnchor="middle" className={`rd-ax${r ? ' on' : ''}`}>{tx(t.cadastre_round_short, { n: i + 1 })}</text>
            {r && r.overall != null ? (
              <>
                <circle cx={x} cy={y(r.overall)} r="5.5" className={`rd-pt${i === h.length - 1 ? ' last' : ''}`} />
                <text x={x} y={y(r.overall) - 11} textAnchor="middle" className="rd-v">{f2(r.overall)}</text>
              </>
            ) : r ? (
              <>
                <circle cx={x} cy={y(0.5)} r="5.5" className="rd-nm" />
                <text x={x} y={y(0.5) - 11} textAnchor="middle" className="rd-ax">{t.cadastre_nm_short}</text>
              </>
            ) : <circle cx={x} cy={y(FEATURE_THRESHOLD)} r="5" className="rd-empty" />}
          </g>
        );
      })}
    </svg>
  );
}

export function DeedFigures(props: Props) {
  const { feature, t, tx, language } = props;
  const cov = feature.council?.coverage ?? null;
  const pct = (v: number) => formatPercent(v, { fromRatio: true, precision: 0, language });
  const under = cov != null && cov < FEATURE_COVERAGE_FLOOR;
  return (
    <section className="sec rise" aria-label={t.cadastre_figures}>
      <h3 className="sec-h">{t.cadastre_figures}</h3>
      <div className="figs">
        <div className="fig" data-role="cad-fig" data-fig="coverage">
          {cov != null ? (
            <Ring v={cov} col={under ? 'var(--c-trouble)' : 'var(--tone)'} label={tx(t.coverage_figure_label, { value: pct(cov), floor: pct(FEATURE_COVERAGE_FLOOR) })} text={pct(cov)} />
          ) : <div className="ring-nm">-</div>}
          <div className="lbl">
            <b>{t.cadastre_coverage}</b>
            <br />
            {cov == null ? t.cadastre_no_council : tx(under ? t.cadastre_under_floor : t.cadastre_clears_floor, { floor: pct(FEATURE_COVERAGE_FLOOR) })}
          </div>
        </div>
        <div className="fig" data-role="cad-fig" data-fig="rounds"><Rounds {...props} /></div>
        <div className="fig" data-role="cad-fig" data-fig="spend">
          <div>
            <div className="val">{feature.spend30dUsd == null ? <span className="nmi">{t.not_measured}</span> : formatNumeric(feature.spend30dUsd, 'usd', { language })}</div>
            <div className="lbl">{t.cadastre_spend}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
