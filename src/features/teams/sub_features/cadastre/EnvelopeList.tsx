// The scenario envelope, numbered as on the rose's outer ring. The approval
// stands at its WORST in-scope cell, never the mean; each row's bucket is the
// board's own fold (`BoardFeature.envelope`), read and never recomputed.
import { formatNumeric } from '@/lib/utils/formatters';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';

import { FEATURE_THRESHOLD, IN_SCOPE_SCOPES } from '../featureRules';
import { proofLabel, scopeLabel, type TFeatures } from '../featuresModel';
import { foldOf, type EnvelopeFold } from './roseGeometry';

function sourceLabel(source: string, t: TFeatures): string {
  switch (source) {
    case 'operator': return t.cadastre_src_operator;
    case 'council': return t.cadastre_src_council;
    case 'telemetry': return t.cadastre_src_telemetry;
    case 'incident': return t.cadastre_src_incident;
    default: return t.cadastre_src_unknown;
  }
}

export interface EnvelopeListProps {
  feature: BoardFeature;
  hotScn: number | null;
  onHotScn: (i: number | null) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

export function EnvelopeList({ feature, hotScn, onHotScn, t, tx, language }: EnvelopeListProps) {
  const rows = feature.scenarios;
  if (rows.length === 0) return null;
  const f2 = (v: number) => formatNumeric(v, 'plain', { language, precision: 2 });
  const inScope = rows.filter((s) => IN_SCOPE_SCOPES.includes(s.scope));
  const stand = (['weak', 'unmeasured', 'holds'] as const).find((k) => inScope.some((s) => foldOf(feature, s.slug) === k)) ?? null;
  const worst = inScope.filter((s) => foldOf(feature, s.slug) === stand);
  const standWord = stand === 'weak' ? t.cadastre_env_weak : stand === 'unmeasured' ? t.not_measured : stand === 'holds' ? t.cadastre_env_holds : t.cadastre_env_none;

  const figure = (k: EnvelopeFold, score: number | null) =>
    score != null ? f2(score) : k === 'out_of_scope' ? t.cadastre_env_out : k === 'proposed' ? t.scope_proposed : <span className="nmi">{t.not_measured}</span>;

  return (
    <section className="sec rise" aria-label={t.scenarios_title}>
      <h3 className="sec-h">
        {t.cadastre_envelope}
        <span className="dim">{tx(rows.length === 1 ? t.cadastre_env_count_one : t.cadastre_env_count_other, { count: rows.length })}</span>
        <span className={`envtag ${stand ?? ''}`} data-role="cad-envtag">{tx(t.cadastre_env_stands, { word: standWord })}</span>
      </h3>
      <p className="prose">
        {t.cadastre_env_rule}
        {worst.length && stand !== 'holds' ? ` ${tx(t.cadastre_env_worst, { names: worst.map((s) => s.title).join(', ') })}` : ''}
      </p>
      <div className="scn">
        {rows.map((s, i) => {
          const k = foldOf(feature, s.slug);
          const l = s.latest;
          const adv = l?.advisory === true;
          const axes = Object.entries(s.axes).map(([a, v]) => `${a.replace(/_/g, ' ')} = ${v}`).join(' · ');
          const sub = [
            s.scope === 'must_hold' ? tx(t.cadastre_env_floor, { value: f2(s.floor) }) : k === 'holds' || k === 'weak' ? tx(t.cadastre_bar, { value: f2(FEATURE_THRESHOLD) }) : null,
            l?.n ? tx(t.sample_label, { count: l.n }) : null,
          ].filter(Boolean).join(' · ');
          return (
            <div key={s.id} className={`sc-row${hotScn === i ? ' hot' : ''}`} onMouseEnter={() => onHotScn(i)} onMouseLeave={() => onHotScn(null)}>
              <span className={`no e-${k}${adv ? ' adv' : ''}`}>{i + 1}</span>
              <div className="sc-m">
                <div className="tt">{s.title}</div>
                <div className="ax">{axes ? `${axes} · ` : ''}{scopeLabel(s.scope, t)} · {tx(t.cadastre_env_from, { source: sourceLabel(s.source, t) })}</div>
              </div>
              <div className={`sc-f ${k}`}>
                {figure(k, l?.state === 'measured' ? l.score : null)}
                {sub ? <small>{sub}</small> : null}
              </div>
              {l?.summary ? (
                <p className="sm">
                  {l.summary}{' '}
                  {adv
                    ? <span className="adv">{tx(t.cadastre_env_advisory, { proof: proofLabel(l.proof, t) })}</span>
                    : <span className="dim">{proofLabel(l.proof, t)}</span>}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
