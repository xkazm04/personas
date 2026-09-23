// The slice inside the layer: a miniature of the same cadastre with the deed's
// parcels lit and joined by the same survey line (owner: keep "the connecting
// lines from a selected deed to its parcels"), then the claimed contexts by
// district. Hovering a context lights its parcel in the miniature.
import { useMemo, useRef, useState } from 'react';

import { useElementSize } from '@/hooks/utility/interaction/useElementSize';

import type { FeaturesModel, TFeatures } from '../featuresModel';
import type { CadRow, ParcelCat } from './cadastreModel';
import { computeLayout, type Measure } from './cadastreLayout';
import { SurveyLines } from './SurveyLines';

export interface DeedSliceProps {
  r: CadRow;
  model: FeaturesModel;
  cats: Map<string, ParcelCat>;
  claims: Map<string, CadRow[]>;
  measure: Measure;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

export function DeedSlice({ r, model, cats, claims, measure, t, tx }: DeedSliceProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(boxRef);
  const [hot, setHot] = useState<string | null>(null);
  const { feature } = r.row;
  const W = Math.max(240, width - 14);
  const H = Math.round(W * 0.56);
  const lay = useMemo(
    () => (width > 0 ? computeLayout(model.plots, cats, W, H, measure, { pad: 2, head: 4, inset: 4, gap: 1.5, margin: 2, min: 3, max: 22 }) : null),
    [width, W, H, model.plots, cats, measure],
  );
  const slice = new Set(feature.contextIds);
  const groupName = new Map(model.plots.map((p) => [p.group.id, p.group.name]));
  const groups = [...new Set(feature.contextIds.map((id) => model.cellById.get(id)?.context.groupId ?? ''))];
  const base = (key: string) => key.split('~')[0];

  return (
    <section className="sec rise" aria-label={t.slice_title}>
      <h3 className="sec-h">
        {t.slice_title}
        <span className="dim">{tx(t.cadastre_slice_note, { count: feature.contextIds.length, total: model.cellById.size })}</span>
      </h3>
      <div ref={boxRef} className="minibox" data-testid="cad-slice-map">
        {lay ? (
          <svg className="minimap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx(t.cadastre_slice_aria, { name: feature.name, count: feature.contextIds.length, total: model.cellById.size })}>
            {lay.districts.map((d) => (
              <rect key={d.id} className={`mdr${feature.contextIds.some((id) => lay.byId.get(id)?.d === d.i) ? ' touch' : ''}`} x={d.x} y={d.y} width={d.w} height={d.h} rx="5" />
            ))}
            {lay.parcels.map((P) => (
              <rect key={P.id} className={`mp c-${P.cat}${slice.has(P.id) ? ' in' : ''}${hot === P.id ? ' hot' : ''}`} x={P.x.toFixed(1)} y={P.y.toFixed(1)} width={P.s.toFixed(1)} height={P.s.toFixed(1)} rx={Math.min(2.5, P.s / 4).toFixed(1)} />
            ))}
            <SurveyLines contextIds={feature.contextIds} primaryId={feature.primaryContextId} lay={lay} measure={measure} drawKey={r.key} />
          </svg>
        ) : null}
      </div>
      <div className="slice">
        {groups.map((g) => (
          <div key={g} className="slice-g">
            <div className="gn">{groupName.get(g) ?? g}</div>
            {feature.contextIds.filter((id) => (model.cellById.get(id)?.context.groupId ?? '') === g).map((id) => {
              const others = (claims.get(id) ?? []).filter((x) => base(x.key) !== base(r.key)).length;
              return (
                <div key={id} className="ctxline" onMouseEnter={() => setHot(id)} onMouseLeave={() => setHot(null)}>
                  <i className={`sw f-${cats.get(id) ?? 'unknown'}`} aria-hidden="true" />
                  <span className="cn">{model.cellById.get(id)?.context.name ?? id}</span>
                  {id === feature.primaryContextId ? <span className="pri">{t.slice_primary}</span> : null}
                  {others ? <span className="co">{tx(t.cadastre_shared_with, { count: others })}</span> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
