// The five council members as bars: weight, score against its floor (red)
// and the bar (dashed). A member nobody measured is a hatched bar that says
// so, never an empty track read as zero.
import { useId } from 'react';

import { formatNumeric, formatPercent } from '@/lib/utils/formatters';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';

import { FEATURE_THRESHOLD } from '../featureRules';
import type { TFeatures } from '../featuresModel';
import { roseDims, type RoseDim } from './roseGeometry';

function Bar({ d, hatch }: { d: RoseDim; hatch: string }) {
  const W = 220;
  const x = (v: number) => 2 + v * (W - 4);
  return (
    <svg viewBox={`0 0 ${W} 22`} preserveAspectRatio="none" aria-hidden="true">
      <rect x="2" y="8" width={W - 4} height="6" rx="3" className="db-trk" />
      {d.score == null
        ? <rect x="2" y="5" width={W - 4} height="12" rx="3" className="db-nm" style={{ fill: `url(#${hatch})` }} />
        : <rect x="2" y="8" width={(x(d.score) - 2).toFixed(1)} height="6" rx="3" className={`db-val${d.floorHit ? ' hit' : ''}`} />}
      <line x1={x(FEATURE_THRESHOLD)} x2={x(FEATURE_THRESHOLD)} y1="2" y2="20" className="db-bar" />
      {d.floor != null ? <line x1={x(d.floor)} x2={x(d.floor)} y1="3" y2="19" className="db-floor" /> : null}
    </svg>
  );
}

export function DeedMembers({ feature, dimName, t, language }: { feature: BoardFeature; dimName: (d: string) => string; t: TFeatures; language: string }) {
  const hatch = `cad-mh-${useId().replace(/:/g, '')}`;
  const dims = roseDims(feature);
  return (
    <section className="sec rise" aria-label={t.cadastre_members}>
      <svg width="0" height="0" className="defs" aria-hidden="true">
        <defs>
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" style={{ fill: 'var(--hatch-bg)' }} />
            <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--hatch-ink)', strokeWidth: 2 }} />
          </pattern>
        </defs>
      </svg>
      <h3 className="sec-h">{t.cadastre_members} <span className="dim">{t.cadastre_members_note}</span></h3>
      {dims.map((d) => (
        <div key={d.dimension} className="dimrow">
          <span className="dn">{dimName(d.dimension)}</span>
          <span className="dw">{formatPercent(d.weight, { fromRatio: true, precision: 0, language })}</span>
          <Bar d={d} hatch={hatch} />
          <span className={`dv${d.score == null ? ' nm' : d.floorHit ? ' hit' : ''}`}>
            {d.score == null
              ? (d.ghost ? t.cadastre_not_judged : t.not_measured)
              : `${formatNumeric(d.score, 'plain', { language, precision: 2 })}${d.floorHit ? ` ${t.cadastre_floor}` : ''}`}
          </span>
        </div>
      ))}
    </section>
  );
}
